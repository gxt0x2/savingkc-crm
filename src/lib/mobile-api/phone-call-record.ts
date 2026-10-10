import { formatPhone } from '@/lib/format'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { handleOptOut } from '@/lib/sms-opt-out'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * Phone-level mobile call outcomes for a manual dial with no lead.
 * Rows stay on lead_activities with lead_id null so the mobile Recordings
 * list, which keeps only a lead or opportunity, does not show them.
 * The same clientCallId for one agent and phone updates that row.
 */
export const MOBILE_PHONE_CALL_SOURCE = 'savingkc_mobile'

const CLIENT_CALL_ID_LIMIT = 200
const NOTE_LIMIT = 2000

export class PhoneCallRecordError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export type UnassignedMobileCallInput = {
  phone: string
  event: 'started' | 'ended'
  durationSeconds: number
  outcome: string | null
  disposition: string | null
  note: string | null
  clientCallId: string | null
  userId: string
  userEmail: string | null
  agentName: string
}

type CallMetadata = Record<string, unknown>
type CallRow = { id: string; metadata?: CallMetadata | null }
type WriteError = { message?: string; code?: string } | null
type WriteResult = { data: { id?: string } | null; error: WriteError }

type FilterQuery = {
  is: (column: string, value: null) => FilterQuery
  eq: (column: string, value: string) => FilterQuery
  limit: (count: number) => FilterQuery
  maybeSingle: () => Promise<{ data: CallRow | null; error: WriteError }>
}

type CallRecordDb = {
  from: (table: 'lead_activities') => {
    select: (columns: string) => FilterQuery
    insert: (row: Record<string, unknown>) => { select: (columns: string) => { single: () => Promise<WriteResult> } }
    update: (row: Record<string, unknown>) => {
      eq: (column: string, value: string) => { select: (columns: string) => { single: () => Promise<WriteResult> } }
    }
  }
}

export function requireE164Phone(phone: string): string {
  const normalized = normalizePhoneToE164(phone)
  if (!normalized) throw new PhoneCallRecordError('A valid US phone number is required', 400)
  return normalized
}

export function boundedCallToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const token = value.trim().toLowerCase()
  return /^[a-z0-9_]{1,40}$/.test(token) ? token : null
}

export function boundedCallNote(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const note = value.trim().slice(0, NOTE_LIMIT)
  return note || null
}

export function boundedClientCallId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (!id) return null
  if (id.length > CLIENT_CALL_ID_LIMIT) {
    throw new PhoneCallRecordError('clientCallId is too long', 400)
  }
  return id
}

/** Write the phone onto the opt-out list the dialer and SMS already honor. */
export async function suppressPhoneForVoiceDnc(phone: string): Promise<void> {
  const e164 = requireE164Phone(phone)
  try {
    await handleOptOut(e164, 'DNC')
  } catch (error) {
    console.error('[mobile-call-events] DNC suppression was not saved', error)
    throw new PhoneCallRecordError('Do-not-call status could not be saved', 500)
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function durationOf(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0
}

function description(phone: string, event: 'started' | 'ended', outcome: string | null): string {
  return event === 'started'
    ? `Mobile outbound call to ${formatPhone(phone)}`
    : `Mobile outbound call ended: ${outcome || 'unknown'}`
}

function mergedCall(input: UnassignedMobileCallInput, previous: CallMetadata | null) {
  const previousEnded = previous?.event === 'ended'
  const keepPrevious = previousEnded && input.event === 'started'
  const event = keepPrevious ? 'ended' : input.event
  const outcome = keepPrevious ? text(previous?.outcome) : (input.outcome ?? text(previous?.outcome))
  const disposition = keepPrevious ? text(previous?.disposition) : (input.disposition ?? text(previous?.disposition))
  const notes = keepPrevious ? text(previous?.notes) : (input.note ?? text(previous?.notes))
  const duration = keepPrevious
    ? durationOf(previous?.duration)
    : Math.max(durationOf(previous?.duration), input.durationSeconds)
  return { event, outcome, disposition, notes, duration } as const
}

function metadataFor(input: UnassignedMobileCallInput, previous: CallMetadata | null): CallMetadata {
  const merged = mergedCall(input, previous)
  return {
    source: MOBILE_PHONE_CALL_SOURCE,
    phoneLevel: true,
    is_internal: true,
    direction: 'outbound',
    phone: input.phone,
    to: input.phone,
    event: merged.event,
    status: merged.event === 'ended' ? 'completed' : 'initiated',
    outcome: merged.outcome,
    disposition: merged.disposition,
    notes: merged.notes,
    duration: merged.duration,
    clientCallId: input.clientCallId,
    userId: input.userId,
    userEmail: input.userEmail,
  }
}

function rowFor(input: UnassignedMobileCallInput, metadata: CallMetadata) {
  return {
    lead_id: null,
    activity_type: 'call',
    description: description(input.phone, metadata.event === 'ended' ? 'ended' : 'started', text(metadata.outcome)),
    agent: input.agentName,
    metadata,
  }
}

async function findExisting(db: CallRecordDb, input: UnassignedMobileCallInput): Promise<CallRow | null> {
  if (!input.clientCallId) return null
  const { data, error } = await db
    .from('lead_activities')
    .select('id, metadata')
    .is('lead_id', null)
    .eq('activity_type', 'call')
    .eq('metadata->>source', MOBILE_PHONE_CALL_SOURCE)
    .eq('metadata->>userId', input.userId)
    .eq('metadata->>phone', input.phone)
    .eq('metadata->>clientCallId', input.clientCallId)
    .limit(1)
    .maybeSingle()
  if (error) throw new PhoneCallRecordError('Call outcome could not be saved', 500)
  return data?.id ? data : null
}

async function updateExisting(db: CallRecordDb, id: string, input: UnassignedMobileCallInput, previous: CallMetadata | null): Promise<string> {
  const metadata = metadataFor(input, previous)
  const { data, error } = await db
    .from('lead_activities')
    .update(rowFor(input, metadata))
    .eq('id', id)
    .select('id')
    .single()
  if (error || !data?.id) throw new PhoneCallRecordError('Call outcome could not be saved', 500)
  return data.id
}

export async function persistUnassignedMobileCall(
  db: ReturnType<typeof supabaseAdmin>,
  input: UnassignedMobileCallInput,
): Promise<{ id: string }> {
  const store = db as unknown as CallRecordDb
  const existing = await findExisting(store, input)
  if (existing?.id) {
    return { id: await updateExisting(store, existing.id, input, existing.metadata ?? null) }
  }

  const metadata = metadataFor(input, null)
  const inserted = await store.from('lead_activities').insert(rowFor(input, metadata)).select('id').single()
  if (!inserted.error && inserted.data?.id) return { id: inserted.data.id }
  if (inserted.error?.code === '23505' && input.clientCallId) {
    const raced = await findExisting(store, input)
    if (raced?.id) return { id: await updateExisting(store, raced.id, input, raced.metadata ?? null) }
  }
  throw new PhoneCallRecordError('Call outcome could not be saved', 500)
}
