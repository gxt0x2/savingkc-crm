import { createHash } from 'crypto'
import { upsertAppointmentFromCall } from '@/lib/appointments'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { applyCrmLifecycleCommand, type CrmLifecycleStage } from '@/lib/server/crm-lifecycle'
import { archiveCanonicalMojoRecording, archivePendingMojoRecordings } from '@/lib/server/mojo-recording-archive'
import { createWorkItem } from '@/lib/server/work-items'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const MOJO_CALL_OUTCOMES = [
  'callback_scheduled',
  'meaningful_conversation',
  'appointment_set',
  'not_interested',
  'wrong_number',
  'disconnected',
  'no_answer',
  'voicemail_left',
  'dnc',
  'already_sold',
  'listed',
  'busy',
  'other',
] as const

export type MojoCallOutcome = (typeof MOJO_CALL_OUTCOMES)[number]

export interface MojoCallRecord {
  record_id: string
  contact_name: string
  phone_number: string
  property_address: string
  city: string
  state: string
  zip: string
  call_date: string
  call_duration: number
  disposition: string
  agent_name: string
  notes?: string
  list_name?: string
  campaign_name?: string
  recording_url?: string
  follow_up_date?: string
  email?: string
}

export interface MojoQueueClaim {
  id: string
  recordId: string
  call: MojoCallRecord
  attempts: number
}

export interface MojoCallIngestResult {
  eventId: string
  leadId: string | null
  activityId: string | null
  outcome: MojoCallOutcome
  normalizedPhone: string | null
  unresolvedReason: 'invalid_phone' | 'duplicate_phone' | 'unknown_contact' | null
  callAt: string
  followUpAt: string | null
  station: string | null
  assignedAgent: string | null
  latestForLead: boolean
  replayed: boolean
}

type Db = ReturnType<typeof supabaseAdmin>

type ProcessDependencies = {
  ingest: typeof ingestCanonicalMojoCall
  suppressDnc: typeof suppressMojoDnc
  createAppointment: typeof createMojoAppointment
  createFollowUp: typeof createMojoFollowUp
  transitionLifecycle: typeof transitionMojoLifecycle
  archiveRecording: typeof archiveCanonicalMojoRecording
}

function stringField(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`invalid_${field}`)
  const result = value.trim()
  if (!result || result.length > max) throw new Error(`invalid_${field}`)
  return result
}

function mojoRecordingUrl(value: unknown): string {
  const raw = stringField(value, 2000)
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    const trustedHost = parsed.hostname === 'mojosells.com' || parsed.hostname.endsWith('.mojosells.com')
    if (parsed.protocol !== 'https:' || !trustedHost) throw new Error('invalid_recording_url')
    return parsed.toString()
  } catch {
    throw new Error('invalid_recording_url')
  }
}

function parseDate(value: unknown, field: string, required: boolean): string | null {
  if ((value === null || value === undefined || value === '') && !required) return null
  const parsed = new Date(String(value))
  if (!Number.isFinite(parsed.getTime())) throw new Error(`invalid_${field}`)
  if (required && (parsed.getTime() < Date.UTC(2000, 0, 1) || parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000)) {
    throw new Error(`invalid_${field}`)
  }
  return parsed.toISOString()
}

export function normalizeMojoCallRecord(value: unknown): MojoCallRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_mojo_call')
  const raw = value as Record<string, unknown>
  const duration = Number(raw.call_duration || 0)
  if (!Number.isFinite(duration) || duration < 0 || duration > 86400) throw new Error('invalid_call_duration')
  const followUpDate = parseDate(raw.follow_up_date, 'follow_up_date', false)
  const recordingUrl = mojoRecordingUrl(raw.recording_url)
  return {
    record_id: requiredString(raw.record_id, 'record_id', 160),
    contact_name: stringField(raw.contact_name, 250),
    phone_number: stringField(raw.phone_number, 80),
    property_address: stringField(raw.property_address, 500),
    city: stringField(raw.city, 160),
    state: stringField(raw.state, 40).toUpperCase(),
    zip: stringField(raw.zip, 30),
    call_date: parseDate(raw.call_date, 'call_date', true) as string,
    call_duration: Math.trunc(duration),
    disposition: requiredString(raw.disposition, 'disposition', 250),
    agent_name: stringField(raw.agent_name, 160),
    ...(stringField(raw.notes, 10000) ? { notes: stringField(raw.notes, 10000) } : {}),
    ...(stringField(raw.list_name, 250) ? { list_name: stringField(raw.list_name, 250) } : {}),
    ...(stringField(raw.campaign_name, 250) ? { campaign_name: stringField(raw.campaign_name, 250) } : {}),
    ...(recordingUrl ? { recording_url: recordingUrl } : {}),
    ...(followUpDate ? { follow_up_date: followUpDate } : {}),
    ...(stringField(raw.email, 320) ? { email: stringField(raw.email, 320).toLowerCase() } : {}),
  }
}

export function mapMojoDisposition(disposition: string): MojoCallOutcome {
  const normalized = disposition.trim().toLowerCase()
  if (normalized.includes('callback') || normalized === 'callback requested') return 'callback_scheduled'
  if (normalized === 'interested' || normalized.includes('motivated')) return 'meaningful_conversation'
  if (normalized.includes('appointment') || normalized === 'appointment set') return 'appointment_set'
  if (normalized.includes('not interested')) return 'not_interested'
  if (normalized === 'wrong number') return 'wrong_number'
  if (normalized === 'disconnected') return 'disconnected'
  if (normalized === 'no answer') return 'no_answer'
  if (normalized.includes('voicemail')) return 'voicemail_left'
  if (normalized === 'dnc request' || normalized.includes('do not call')) return 'dnc'
  if (normalized === 'already sold' || normalized.includes('sold')) return 'already_sold'
  if (normalized.includes('listed') || normalized.includes('agent')) return 'listed'
  if (normalized === 'busy') return 'busy'
  return 'other'
}

function stableUuid(scope: string, value: string): string {
  const hex = createHash('sha256').update(`${scope}:${value}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function parseIngestResult(value: unknown): MojoCallIngestResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_mojo_ingest_result')
  const row = value as Record<string, unknown>
  if (typeof row.eventId !== 'string' || typeof row.outcome !== 'string' || typeof row.callAt !== 'string') {
    throw new Error('invalid_mojo_ingest_result')
  }
  if (!MOJO_CALL_OUTCOMES.includes(row.outcome as MojoCallOutcome)) throw new Error('invalid_mojo_ingest_result')
  return {
    eventId: row.eventId,
    leadId: typeof row.leadId === 'string' ? row.leadId : null,
    activityId: typeof row.activityId === 'string' ? row.activityId : null,
    outcome: row.outcome as MojoCallOutcome,
    normalizedPhone: typeof row.normalizedPhone === 'string' ? row.normalizedPhone : null,
    unresolvedReason: row.unresolvedReason === 'invalid_phone' || row.unresolvedReason === 'duplicate_phone' || row.unresolvedReason === 'unknown_contact'
      ? row.unresolvedReason
      : null,
    callAt: row.callAt,
    followUpAt: typeof row.followUpAt === 'string' ? row.followUpAt : null,
    station: typeof row.station === 'string' ? row.station : null,
    assignedAgent: typeof row.assignedAgent === 'string' ? row.assignedAgent : null,
    latestForLead: row.latestForLead === true,
    replayed: row.replayed === true,
  }
}

export async function claimMojoCallQueue(limit = 5, db: Db = supabaseAdmin()): Promise<MojoQueueClaim[]> {
  const { data, error } = await db.rpc('claim_mojo_call_queue_v1', {
    p_limit: Math.max(1, Math.min(Math.trunc(limit), 10)),
  })
  if (error) throw new Error(`Mojo queue claim failed: ${error.message}`)
  if (!Array.isArray(data)) throw new Error('Mojo queue claim returned invalid data')
  return data.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Mojo queue claim returned invalid data')
    const item = row as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.record_id !== 'string' || typeof item.attempts !== 'number') {
      throw new Error('Mojo queue claim returned invalid data')
    }
    const call = normalizeMojoCallRecord(item.payload)
    if (call.record_id !== item.record_id) throw new Error('Mojo queue record identity mismatch')
    return { id: item.id, recordId: item.record_id, call, attempts: item.attempts }
  })
}

export async function finishMojoCallQueue(input: {
  queueId: string
  success: boolean
  leadId?: string | null
  callEventId?: string | null
  error?: string | null
}, db: Db = supabaseAdmin()): Promise<string> {
  const { data, error } = await db.rpc('finish_mojo_call_queue_v1', {
    p_queue_id: input.queueId,
    p_success: input.success,
    p_lead_id: input.leadId || null,
    p_call_event_id: input.callEventId || null,
    p_error: input.error?.slice(0, 1000) || null,
  })
  if (error) throw new Error(`Mojo queue finish failed: ${error.message}`)
  if (typeof data !== 'string') throw new Error('Mojo queue finish returned invalid data')
  return data
}

export async function ingestCanonicalMojoCall(call: MojoCallRecord, db: Db = supabaseAdmin()): Promise<MojoCallIngestResult> {
  const normalized = normalizeMojoCallRecord(call)
  const { data, error } = await db.rpc('ingest_crm_mojo_call_v1', {
    p_call: normalized,
    p_outcome: mapMojoDisposition(normalized.disposition),
    p_call_at: normalized.call_date,
    p_follow_up_at: normalized.follow_up_date || null,
  })
  if (error) throw new Error(`Mojo call ingestion failed: ${error.message}`)
  return parseIngestResult(data)
}

export async function suppressMojoDnc(phone: string, db: Db = supabaseAdmin()): Promise<void> {
  const normalized = normalizePhoneToE164(phone)
  if (!normalized) throw new Error('Mojo DNC phone is invalid')
  const { error } = await db.from('sms_opt_outs').upsert({
    phone: normalized,
    is_opted_out: true,
    opted_out_at: new Date().toISOString(),
    reason: 'MOJO_DNC',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'phone' })
  if (error) throw new Error(`Mojo DNC suppression failed: ${error.message}`)
}

function operationalAssignee(result: MojoCallIngestResult, call: MojoCallRecord): string {
  if (result.assignedAgent?.trim()) return result.assignedAgent.trim()
  const agent = call.agent_name.trim()
  return agent && !agent.toLowerCase().includes('sync') && !agent.toLowerCase().includes('system') ? agent : 'Casey'
}

export async function createMojoAppointment(result: MojoCallIngestResult, call: MojoCallRecord): Promise<void> {
  if (!result.leadId || !result.followUpAt) return
  const appointment = await upsertAppointmentFromCall({
    leadId: result.leadId,
    scheduledAt: result.followUpAt,
    type: 'phone_call',
    address: call.property_address || null,
    notes: call.notes || `Mojo appointment from ${call.record_id}`,
    source: 'mojo_sync',
    sourceCallId: call.record_id,
    assignedTo: operationalAssignee(result, call),
  })
  if (!appointment) throw new Error('Mojo appointment could not be saved')
}

export async function createMojoFollowUp(result: MojoCallIngestResult, call: MojoCallRecord): Promise<void> {
  if (!result.leadId || !result.followUpAt) return
  if (Date.parse(result.followUpAt) < Date.now() - 5 * 60 * 1000) return
  await createWorkItem({
    actor: 'Mojo Import',
    idempotencyKey: `mojo:${call.record_id}:follow-up`,
    leadId: result.leadId,
    kind: 'callback',
    title: `Follow up after Mojo call with ${call.contact_name || 'seller'}`,
    notes: call.notes || `Provider disposition: ${call.disposition}`,
    dueAt: result.followUpAt,
    assignedTo: operationalAssignee(result, call),
    department: 'acquisitions',
    role: 'setter',
    priority: 'normal',
    primaryNextAction: false,
    provenance: {
      source: 'mojo_call_event',
      provider: 'mojo',
      record_id: call.record_id,
      event_id: result.eventId,
      event_backed: true,
    },
  })
}

function lifecycleTarget(result: MojoCallIngestResult): { stage: CrmLifecycleStage; deadReason: string | null } | null {
  const current = result.station || 'new'
  const terminal = ['offer_made', 'under_contract', 'closed_won', 'closed_lost', 'dead'].includes(current)
  if (terminal) return null
  if (result.outcome === 'not_interested') return { stage: 'dead', deadReason: 'not_selling' }
  if (result.outcome === 'already_sold') return { stage: 'dead', deadReason: 'already_sold' }
  if (result.outcome === 'dnc') return { stage: 'dead', deadReason: 'dnc' }
  if (result.outcome === 'appointment_set' && result.followUpAt) return { stage: 'appointment_set', deadReason: null }
  if ((result.outcome === 'meaningful_conversation' || result.outcome === 'callback_scheduled') && current === 'new') {
    return { stage: 'contacted', deadReason: null }
  }
  return null
}

export async function transitionMojoLifecycle(result: MojoCallIngestResult, call: MojoCallRecord): Promise<void> {
  if (!result.leadId || !result.latestForLead) return
  const terminal = ['under_contract', 'closed_won', 'closed_lost', 'dead'].includes(result.station || '')
  if (!result.assignedAgent && !terminal) {
    await applyCrmLifecycleCommand({
      leadId: result.leadId,
      commandId: stableUuid('mojo-owner', call.record_id),
      commandType: 'assign',
      stage: null,
      owner: operationalAssignee(result, call),
      deadReason: null,
      deadReasonNotes: null,
      reason: `Provider call ownership from Mojo call ${call.record_id}`,
      evidenceType: null,
      evidenceReference: `mojo:${call.record_id}`,
      actorEmail: 'system@crm.savingkc.com',
      actorName: 'Mojo Import',
    })
  }
  const target = lifecycleTarget(result)
  if (!target) return
  await applyCrmLifecycleCommand({
    leadId: result.leadId,
    commandId: stableUuid('mojo-lifecycle', call.record_id),
    commandType: 'transition',
    stage: target.stage,
    owner: null,
    deadReason: target.deadReason,
    deadReasonNotes: target.deadReason ? `Mojo disposition: ${call.disposition}` : null,
    reason: `Verified Mojo disposition from call ${call.record_id}`,
    evidenceType: null,
    evidenceReference: `mojo:${call.record_id}`,
    actorEmail: 'system@crm.savingkc.com',
    actorName: 'Mojo Import',
  })
}

export async function processCanonicalMojoCall(
  call: MojoCallRecord,
  dependencies: ProcessDependencies = {
    ingest: ingestCanonicalMojoCall,
    suppressDnc: suppressMojoDnc,
    createAppointment: createMojoAppointment,
    createFollowUp: createMojoFollowUp,
    transitionLifecycle: transitionMojoLifecycle,
    archiveRecording: archiveCanonicalMojoRecording,
  },
): Promise<MojoCallIngestResult> {
  const normalized = normalizeMojoCallRecord(call)
  const result = await dependencies.ingest(normalized)

  if (result.outcome === 'dnc' && result.normalizedPhone) {
    await dependencies.suppressDnc(result.normalizedPhone)
  }
  if (result.leadId) {
    if (result.outcome === 'appointment_set' && result.followUpAt) {
      await dependencies.createAppointment(result, normalized)
    } else if (result.followUpAt && ['callback_scheduled', 'meaningful_conversation'].includes(result.outcome)) {
      await dependencies.createFollowUp(result, normalized)
    }
    await dependencies.transitionLifecycle(result, normalized)
  }

  // Archive provider media last so safety/lifecycle effects are never delayed
  // by a transient audio download. Queue retries are safe because both the
  // canonical event and archive path are idempotent.
  if (normalized.recording_url) await dependencies.archiveRecording(result, normalized)
  return result
}

export async function runCanonicalMojoQueueWorker(input: {
  limit?: number
  claim?: typeof claimMojoCallQueue
  process?: typeof processCanonicalMojoCall
  finish?: typeof finishMojoCallQueue
  archiveBacklog?: typeof archivePendingMojoRecordings
} = {}) {
  const claim = input.claim || claimMojoCallQueue
  const process = input.process || processCanonicalMojoCall
  const finish = input.finish || finishMojoCallQueue
  const archiveBacklog = input.archiveBacklog || archivePendingMojoRecordings
  const claims = await claim(input.limit || 5)
  const results: Array<{ recordId: string; status: string; leadId?: string | null; error?: string }> = []

  for (const item of claims) {
    try {
      const result = await process(item.call)
      const status = await finish({
        queueId: item.id,
        success: true,
        leadId: result.leadId,
        callEventId: result.eventId,
      })
      results.push({ recordId: item.recordId, status, leadId: result.leadId })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Mojo import error'
      try {
        const status = await finish({ queueId: item.id, success: false, error: message })
        results.push({ recordId: item.recordId, status, error: message })
      } catch (finishError) {
        console.error('[mojo-queue] failed to release claim', item.recordId, finishError)
        results.push({ recordId: item.recordId, status: 'claim_release_failed', error: message })
      }
    }
  }

  let recordingArchive = { inspected: 0, archived: 0, failed: 0 }
  try {
    recordingArchive = await archiveBacklog(Math.min(input.limit || 5, 5))
  } catch (error) {
    recordingArchive.failed = 1
    console.error('[mojo-queue] recording backlog unavailable', error)
  }

  return {
    claimed: claims.length,
    completed: results.filter((result) => result.status === 'completed').length,
    pending: results.filter((result) => result.status === 'pending').length,
    deadLetter: results.filter((result) => result.status === 'dead_letter').length,
    failed: results.filter((result) => result.status === 'claim_release_failed').length,
    recordingArchive,
    results,
  }
}
