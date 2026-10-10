import { isInternalVoiceDncReason, phoneLookupVariants } from '@/lib/dialer-call-policy'
import { mobileCommandIdentityUuid } from '@/lib/mobile-api/command-receipts'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

/**
 * Manual contact create for the mobile sheet. This follows the CRM contact
 * insert (station new, warm, not parked) and does not run website intake.
 * source is mobile_manual and the owner is the signed-in agent.
 */
export const MOBILE_MANUAL_LEAD_SOURCE = 'mobile_manual'

const NAME_LIMIT = 200
const ADDRESS_LIMIT = 500
const NOTES_LIMIT = 5000
const CLIENT_REQUEST_ID_LIMIT = 200
const EMAIL_LIMIT = 320
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class CreateMobileLeadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export type CreateMobileLeadResult = {
  ok: true
  leadId: string
  existing: boolean
}

type WriteError = { message?: string; code?: string } | null
type LeadHit = { id?: string | null; phone?: string | null; email?: string | null }
type ReceiptHit = { lead_id?: string | null }
type SuppressionHit = { reason?: string | null; is_opted_out?: boolean | null }

type RowResult<T> = { data: T | null; error: WriteError }

interface Filter<T> {
  in: (column: string, values: readonly string[]) => Filter<T>
  ilike: (column: string, value: string) => Filter<T>
  eq: (column: string, value: string | boolean) => Filter<T>
  limit: (count: number) => Filter<T> & PromiseLike<RowResult<T[]>>
  maybeSingle: () => Promise<RowResult<T>>
}

export interface MobileLeadWriter {
  from: (table: 'leads' | 'lead_activities' | 'sms_opt_outs') => {
    select: (columns: string) => Filter<LeadHit & ReceiptHit & SuppressionHit>
    insert: (row: Record<string, unknown>) => {
      select: (columns: string) => { single: () => Promise<RowResult<{ id?: string }>> }
    }
  }
}

type ParsedContact = {
  name: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  clientRequestId: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CreateMobileLeadError('Invalid request body', 400)
  }
  return value as Record<string, unknown>
}

function requiredName(value: unknown): string {
  const name = text(value)
  if (!name) throw new CreateMobileLeadError('Name is required', 400)
  if (name.length > NAME_LIMIT) throw new CreateMobileLeadError('Name is too long', 400)
  return name
}

function optionalPhone(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string' && !value.trim()) return null
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new CreateMobileLeadError('A valid US phone number is required', 400)
  }
  const normalized = normalizePhoneToE164(value)
  if (!normalized) throw new CreateMobileLeadError('A valid US phone number is required', 400)
  return normalized
}

function optionalEmail(value: unknown): string | null {
  const email = text(value)?.toLowerCase() ?? null
  if (!email) return null
  if (email.length > EMAIL_LIMIT || !EMAIL_PATTERN.test(email)) {
    throw new CreateMobileLeadError('A valid email is required', 400)
  }
  return email
}

function bounded(value: unknown, limit: number, message: string): string | null {
  const cleaned = text(value)
  if (!cleaned) return null
  if (cleaned.length > limit) throw new CreateMobileLeadError(message, 400)
  return cleaned
}

function parseContact(value: unknown): ParsedContact {
  const body = readBody(value)
  const name = requiredName(body.name)
  const phone = optionalPhone(body.phone)
  const email = optionalEmail(body.email)
  if (!phone && !email) throw new CreateMobileLeadError('A phone number or email is required', 400)
  return {
    name,
    phone,
    email,
    address: bounded(body.address, ADDRESS_LIMIT, 'Address is too long'),
    notes: bounded(body.notes, NOTES_LIMIT, 'Notes are too long'),
    clientRequestId: bounded(body.clientRequestId, CLIENT_REQUEST_ID_LIMIT, 'clientRequestId is too long'),
  }
}

export function mobileManualLeadId(userId: string, clientRequestId: string): string {
  return mobileCommandIdentityUuid(userId, clientRequestId, 'mobile_manual_lead')
}

function exactIlike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

async function rows<T>(query: Filter<T> & PromiseLike<RowResult<T[]>>): Promise<T[]> {
  const { data, error } = await query
  if (error) throw new CreateMobileLeadError('Contact lookup failed', 500)
  return data ?? []
}

async function findReceipt(db: MobileLeadWriter, userId: string, clientRequestId: string): Promise<string | null> {
  const { data, error } = await db
    .from('lead_activities')
    .select('lead_id')
    .eq('activity_type', 'status_change')
    .eq('metadata->>source', MOBILE_MANUAL_LEAD_SOURCE)
    .eq('metadata->>userId', userId)
    .eq('metadata->>clientRequestId', clientRequestId)
    .limit(1)
    .maybeSingle()
  if (error) throw new CreateMobileLeadError('Contact lookup failed', 500)
  const leadId = text(data?.lead_id)
  if (data && !leadId) throw new CreateMobileLeadError('Contact could not be saved', 500)
  return leadId
}

async function matchingLeadIds(db: MobileLeadWriter, contact: ParsedContact): Promise<string[]> {
  const ids = new Set<string>()
  if (contact.phone) {
    const hits = await rows(db.from('leads').select('id, phone, email').in('phone', phoneLookupVariants(contact.phone)).limit(5))
    for (const hit of hits) {
      if (hit.id && normalizePhoneToE164(hit.phone) === contact.phone) ids.add(hit.id)
    }
  }
  if (contact.email) {
    const hits = await rows(db.from('leads').select('id, phone, email').ilike('email', exactIlike(contact.email)).limit(5))
    for (const hit of hits) {
      if (hit.id && text(hit.email)?.toLowerCase() === contact.email) ids.add(hit.id)
    }
  }
  return [...ids]
}

async function voiceDncReason(db: MobileLeadWriter, phone: string): Promise<string | null> {
  const { data, error } = await db
    .from('sms_opt_outs')
    .select('reason, is_opted_out')
    .eq('phone', phone)
    .eq('is_opted_out', true)
    .limit(1)
    .maybeSingle()
  if (error) throw new CreateMobileLeadError('Do-not-call status could not be verified', 500)
  if (!data?.is_opted_out || !isInternalVoiceDncReason(data.reason)) return null
  return 'dnc_refused'
}

async function rememberRequest(
  db: MobileLeadWriter,
  input: { leadId: string; userId: string; agentName: string; clientRequestId: string },
): Promise<'saved' | 'conflict'> {
  const { error } = await db.from('lead_activities').insert({
    lead_id: input.leadId,
    activity_type: 'status_change',
    description: 'Mobile contact saved',
    agent: input.agentName,
    metadata: {
      source: MOBILE_MANUAL_LEAD_SOURCE,
      action: 'create_contact',
      clientRequestId: input.clientRequestId,
      userId: input.userId,
      is_internal: true,
    },
  }).select('id').single()
  if (!error) return 'saved'
  if (error.code === '23505') return 'conflict'
  throw new CreateMobileLeadError('Contact could not be saved', 500)
}

async function finishExisting(
  db: MobileLeadWriter,
  input: { leadId: string; userId: string; agentName: string; clientRequestId: string | null },
): Promise<CreateMobileLeadResult> {
  if (!input.clientRequestId) return { ok: true, leadId: input.leadId, existing: true }
  const saved = await rememberRequest(db, { ...input, clientRequestId: input.clientRequestId })
  if (saved === 'saved') return { ok: true, leadId: input.leadId, existing: true }
  const winner = await findReceipt(db, input.userId, input.clientRequestId)
  if (!winner) throw new CreateMobileLeadError('Contact could not be saved', 500)
  return { ok: true, leadId: winner, existing: true }
}

export async function createMobileManualLead(
  db: MobileLeadWriter,
  input: { userId: string; agentName: string; body: unknown },
): Promise<CreateMobileLeadResult> {
  const contact = parseContact(input.body)
  if (contact.clientRequestId) {
    const prior = await findReceipt(db, input.userId, contact.clientRequestId)
    if (prior) return { ok: true, leadId: prior, existing: true }
  }

  const matches = await matchingLeadIds(db, contact)
  if (matches.length > 1) {
    throw new CreateMobileLeadError('More than one contact matches this phone or email', 409)
  }
  if (matches.length === 1) {
    return finishExisting(db, {
      leadId: matches[0],
      userId: input.userId,
      agentName: input.agentName,
      clientRequestId: contact.clientRequestId,
    })
  }

  const presetId = contact.clientRequestId ? mobileManualLeadId(input.userId, contact.clientRequestId) : null
  const deadReason = contact.phone ? await voiceDncReason(db, contact.phone) : null
  const { data, error } = await db.from('leads').insert({
    ...(presetId ? { id: presetId } : {}),
    full_name: contact.name,
    phone: contact.phone,
    email: contact.email,
    property_address: contact.address,
    city: null,
    state: null,
    zip: null,
    source: MOBILE_MANUAL_LEAD_SOURCE,
    station: 'new',
    priority: 'warm',
    is_parked: false,
    assigned_agent: input.agentName,
    notes: contact.notes,
    ...(deadReason ? { dead_reason: deadReason } : {}),
  }).select('id').single()

  if (error?.code === '23505' && presetId) {
    return finishExisting(db, {
      leadId: presetId,
      userId: input.userId,
      agentName: input.agentName,
      clientRequestId: contact.clientRequestId,
    })
  }
  const leadId = text(data?.id)
  if (error || !leadId) throw new CreateMobileLeadError('Contact could not be saved', 500)
  if (!contact.clientRequestId) return { ok: true, leadId, existing: false }
  const saved = await rememberRequest(db, {
    leadId,
    userId: input.userId,
    agentName: input.agentName,
    clientRequestId: contact.clientRequestId,
  })
  if (saved === 'saved') return { ok: true, leadId, existing: false }
  const winner = await findReceipt(db, input.userId, contact.clientRequestId)
  if (!winner) throw new CreateMobileLeadError('Contact could not be saved', 500)
  return { ok: true, leadId: winner, existing: true }
}
