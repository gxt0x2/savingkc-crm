import fs from 'node:fs'
import { centralDateString, parseMojoRecordingDuration, parseMojoTimestamp } from '../../../scripts/mojo-call-evidence.mjs'

export const MOJO_CALL_SOURCES = ['mojo_mcp_list_calls', 'mojo_session_recordings'] as const
export type MojoCallSourceKind = (typeof MOJO_CALL_SOURCES)[number]

export const MOJO_CALL_BACKFILL_FROM = '2026-10-09'
export const MOJO_CALL_BACKFILL_TO = '2026-10-19'
export const MOJO_CALL_BACKFILL_SESSIONS = {
  date: '2026-10-19',
  sessions: { '474': 3, '475': 47, '476': 296 },
  callIds: { min: 31597, max: 31942 },
} as const

const FORBIDDEN_FIELDS = [
  'phone_number', 'caller_number', 'contact_name', 'agent_name', 'notes',
  'email', 'recording_url', 'audio', 'name',
]
const INITIALS = /^[A-Z](?:\.[A-Z]){0,3}\.$/
const RESULT_LABEL = /^[A-Za-z][A-Za-z0-9 /&'.,+-]{0,79}$/

export type MojoCallFact = {
  record_id: string
  provider_call_id: string
  provider_contact_id: string | null
  call_at: string
  dial_session_id: string | null
  contact_initials: string | null
  phone_last4: string | null
  duration_seconds: number
  result_code: number | null
  result_label: string | null
  is_recorded: boolean | null
  appointment_count: number | null
  lead_exists: boolean | null
  source: MojoCallSourceKind
}

export type MojoCallLedgerRow = MojoCallFact & { lead_id: string | null }

export type MojoCallUpsertResult = {
  recordId: string
  leadId: string | null
  replayed: boolean
  inserted: boolean
}

export type MojoCallListQuery = {
  dateFrom: string
  dateTo: string
  page?: number
  pageSize?: number
}

export type MojoCallListPage = {
  totalCount: number
  totalPages: number
  page: number
  results: MojoCallFact[]
  skippedUnkeyed: number
}

export interface MojoCallSource {
  readonly kind: MojoCallSourceKind
  listCalls(query: MojoCallListQuery): Promise<MojoCallListPage>
}

export type MojoCallDb = {
  rpc: (fn: string, args: { p_call: MojoCallFact }) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

type CallInput = {
  id?: unknown
  call_id?: unknown
  create_date?: unknown
  call_at?: unknown
  datetime?: unknown
  date?: unknown
  phone_number?: unknown
  phone?: unknown
  duration?: unknown
  duration_seconds?: unknown
  result?: unknown
  result_code?: unknown
  result_label?: unknown
  dial_session_id?: unknown
  is_recorded?: unknown
  appointment_count?: unknown
  lead_exists?: unknown
  contact_id?: unknown
  contact_initials?: unknown
  contact?: { id?: unknown; phone?: unknown } | null
}

export function mojoCallRecordId(callId: number): string {
  return `mojo-call-${callId}`
}

export function parseMojoCallBackfillArgs(argv: string[]) {
  return { apply: argv.includes('--apply'), dryRun: !argv.includes('--apply') }
}

export function readMojoSessionId(file: string): string | null {
  try {
    if (!fs.existsSync(file)) return null
    const session = JSON.parse(fs.readFileSync(file, 'utf8')) as { sessionId?: unknown; expired?: unknown }
    if (session.expired === true || typeof session.sessionId !== 'string' || !session.sessionId.trim()) return null
    return session.sessionId
  } catch {
    return null
  }
}

export function eachCalendarDate(from: string, to: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error('invalid_mojo_call_window')
  }
  const dates: string[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

export function expectedMojoCallCounts(from = MOJO_CALL_BACKFILL_FROM, to = MOJO_CALL_BACKFILL_TO): Record<string, number> {
  return Object.fromEntries(eachCalendarDate(from, to).map((date) => {
    if (date === '2026-10-09') return [date, 249]
    if (date === '2026-10-19') return [date, 346]
    return [date, 0]
  }))
}

export function phoneLast4(value: unknown): string | null {
  if (value == null || value === '') return null
  const digits = String(value).replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : null
}

export function contactInitials(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return INITIALS.test(text) ? text : null
}

function integerId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10 ** 18) return value
  if (typeof value === 'string' && /^\d{1,18}$/.test(value.trim())) return Number(value.trim())
  return null
}

function optionalCount(value: unknown, max: number): number | null {
  if (value == null || value === '') return null
  const parsed = integerId(value)
  if (parsed == null || parsed > max) throw new Error('invalid_mojo_call_count')
  return parsed
}

function durationSeconds(value: unknown): number {
  if (value == null || value === '') return 0
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 86400) throw new Error('invalid_mojo_call_duration')
    return value
  }
  const parsed = parseMojoRecordingDuration(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 86400) throw new Error('invalid_mojo_call_duration')
  return parsed
}

function resultLabel(value: unknown): string | null {
  if (value == null || value === '') return null
  const text = String(value).trim()
  if (!text) return null
  if (text.length > 80 || /\d{7}/.test(text) || !RESULT_LABEL.test(text)) throw new Error('invalid_mojo_call_result_label')
  return text
}

function optionalBoolean(value: unknown): boolean | null {
  if (value == null || value === '') return null
  if (value === true || value === 1 || value === '1') return true
  if (value === false || value === 0 || value === '0') return false
  throw new Error('invalid_mojo_call_flag')
}

function callTimestamp(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) throw new Error('invalid_mojo_call_time')
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(raw)) return parseMojoTimestamp(raw)
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) throw new Error('invalid_mojo_call_time')
  return new Date(parsed).toISOString()
}

function fact(input: CallInput, source: MojoCallSourceKind, callId: number): MojoCallFact {
  const contact = integerId(input.contact_id ?? input.contact?.id)
  const session = integerId(input.dial_session_id)
  const phone = input.phone_number ?? input.phone ?? input.contact?.phone
  const label = typeof input.result_label === 'string'
    ? input.result_label
    : typeof input.result === 'string' ? input.result : null
  const code = input.result_code ?? (typeof input.result === 'number' ? input.result : null)
  return {
    record_id: mojoCallRecordId(callId),
    provider_call_id: String(callId),
    provider_contact_id: contact == null ? null : String(contact),
    call_at: callTimestamp(input.create_date ?? input.call_at ?? input.datetime ?? input.date),
    dial_session_id: session == null ? null : String(session),
    contact_initials: contactInitials(input.contact_initials),
    phone_last4: phoneLast4(phone),
    duration_seconds: durationSeconds(input.duration_seconds ?? input.duration),
    result_code: optionalCount(code, 999),
    result_label: resultLabel(label),
    is_recorded: optionalBoolean(input.is_recorded),
    appointment_count: optionalCount(input.appointment_count, 1000),
    lead_exists: optionalBoolean(input.lead_exists),
    source,
  }
}

export function mapOfficialListCall(value: unknown): MojoCallFact {
  const input = objectInput(value)
  const callId = integerId(input.id)
  if (callId == null) throw new Error('invalid_mojo_call_id')
  const mapped = fact(input, 'mojo_mcp_list_calls', callId)
  if (mapped.is_recorded == null || mapped.lead_exists == null || mapped.appointment_count == null) {
    throw new Error('invalid_mojo_call')
  }
  return mapped
}

export function mapRecordingReportRow(value: unknown): MojoCallFact | null {
  const input = objectInput(value)
  const callId = integerId(input.call_id)
  if (callId == null) return null
  return { ...fact(input, 'mojo_session_recordings', callId), is_recorded: true }
}

function objectInput(value: unknown): CallInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_mojo_call')
  return value as CallInput
}

export function assertMojoCallFact(value: unknown): MojoCallFact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_mojo_call')
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_FIELDS.includes(key)) throw new Error('mojo_call_payload_has_forbidden_field')
  }
  const source = record.source
  if (source !== 'mojo_mcp_list_calls' && source !== 'mojo_session_recordings') throw new Error('invalid_mojo_call_source')
  return fact({
    id: record.provider_call_id,
    create_date: record.call_at,
    phone_number: record.phone_last4,
    duration_seconds: record.duration_seconds,
    result_code: record.result_code,
    result_label: record.result_label,
    dial_session_id: record.dial_session_id,
    is_recorded: record.is_recorded,
    appointment_count: record.appointment_count,
    lead_exists: record.lead_exists,
    contact_id: record.provider_contact_id,
    contact_initials: record.contact_initials,
  }, source, requiredId(record.provider_call_id))
}

function requiredId(value: unknown): number {
  const parsed = integerId(value)
  if (parsed == null) throw new Error('invalid_mojo_call_id')
  return parsed
}

export function applyCrmMojoCallUpsert(
  existing: MojoCallLedgerRow | null,
  incoming: MojoCallFact,
  leadId: string | null,
): { row: MojoCallLedgerRow; replayed: boolean; inserted: boolean } {
  const next: MojoCallLedgerRow = { ...assertMojoCallFact(incoming), lead_id: leadId }
  if (existing && JSON.stringify(existing) === JSON.stringify(next)) {
    return { row: existing, replayed: true, inserted: false }
  }
  return { row: next, replayed: false, inserted: existing == null }
}

export async function listAllMojoCalls(source: MojoCallSource, dateFrom: string, dateTo: string): Promise<{
  calls: MojoCallFact[]
  skippedUnkeyed: number
}> {
  const calls: MojoCallFact[] = []
  const seen = new Set<string>()
  let page = 1
  let totalPages = 1
  let totalCount = 0
  let skippedUnkeyed = 0
  do {
    const batch = await source.listCalls({ dateFrom, dateTo, page, pageSize: 500 })
    totalPages = batch.totalPages
    totalCount = batch.totalCount
    if (page === 1) skippedUnkeyed = batch.skippedUnkeyed
    for (const row of batch.results) {
      const factRow = assertMojoCallFact(row)
      if (seen.has(factRow.record_id)) throw new Error('mojo_call_page_duplicate')
      seen.add(factRow.record_id)
      calls.push(factRow)
    }
    page += 1
    if (page > 50) throw new Error('mojo_call_page_limit')
  } while (page <= totalPages && totalPages > 0)
  if (calls.length !== totalCount) throw new Error('mojo_call_page_incomplete')
  return { calls, skippedUnkeyed }
}

export async function upsertCrmMojoCalls(db: MojoCallDb, calls: MojoCallFact[]): Promise<MojoCallUpsertResult[]> {
  const results: MojoCallUpsertResult[] = []
  for (const call of calls) {
    const payload = assertMojoCallFact(call)
    const { data, error } = await db.rpc('upsert_crm_mojo_call_v1', { p_call: payload })
    if (error) throw new Error(`Mojo call upsert failed: ${error.message}`)
    results.push(parseUpsertResult(data))
  }
  return results
}

function parseUpsertResult(value: unknown): MojoCallUpsertResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_mojo_call_upsert_result')
  const row = value as Record<string, unknown>
  if (typeof row.recordId !== 'string' || typeof row.replayed !== 'boolean' || typeof row.inserted !== 'boolean') {
    throw new Error('invalid_mojo_call_upsert_result')
  }
  return {
    recordId: row.recordId,
    leadId: typeof row.leadId === 'string' ? row.leadId : null,
    replayed: row.replayed,
    inserted: row.inserted,
  }
}

export type MojoCallBackfillSummary = {
  dailyCalls: Record<string, number>
  sessions: Record<string, number>
  callIds: { min: number | null; max: number | null; count: number }
}

export function summarizeMojoCallBackfill(calls: MojoCallFact[], from: string, to: string): MojoCallBackfillSummary {
  const dailyCalls = Object.fromEntries(eachCalendarDate(from, to).map((date) => [date, 0]))
  const sessions: Record<string, number> = {}
  let min: number | null = null
  let max: number | null = null
  let count = 0
  for (const call of calls) {
    const date = centralDateString(new Date(call.call_at))
    if (date in dailyCalls) dailyCalls[date] += 1
    if (date === MOJO_CALL_BACKFILL_SESSIONS.date) {
      count += 1
      const id = Number(call.provider_call_id)
      min = min == null ? id : Math.min(min, id)
      max = max == null ? id : Math.max(max, id)
      if (call.dial_session_id) sessions[call.dial_session_id] = (sessions[call.dial_session_id] ?? 0) + 1
    }
  }
  return { dailyCalls, sessions, callIds: { min, max, count } }
}

export function compareMojoCallBackfill(summary: MojoCallBackfillSummary, from = MOJO_CALL_BACKFILL_FROM, to = MOJO_CALL_BACKFILL_TO) {
  const expectedDaily = expectedMojoCallCounts(from, to)
  const dailyMismatches = Object.keys(expectedDaily).filter((date) => summary.dailyCalls[date] !== expectedDaily[date])
  const expectedSessions: Record<string, number> = { ...MOJO_CALL_BACKFILL_SESSIONS.sessions }
  const sessionMismatches = Object.keys(expectedSessions).filter((session) =>
    summary.sessions[session] !== expectedSessions[session])
  const ids = MOJO_CALL_BACKFILL_SESSIONS.callIds
  const callIdsMatch = summary.callIds.min === ids.min
    && summary.callIds.max === ids.max
    && summary.callIds.count === ids.max - ids.min + 1
  return {
    matches: dailyMismatches.length === 0 && sessionMismatches.length === 0 && callIdsMatch,
    expectedDaily,
    dailyMismatches,
    sessionMismatches,
    callIdsMatch,
  }
}

export async function runMojoCallBackfill(options: {
  source: MojoCallSource
  from?: string
  to?: string
  apply: boolean
  db?: MojoCallDb
}): Promise<{
  dryRun: boolean
  calls: number
  skippedUnkeyed: number
  summary: MojoCallBackfillSummary
  comparison: ReturnType<typeof compareMojoCallBackfill>
  written: number
}> {
  const from = options.from ?? MOJO_CALL_BACKFILL_FROM
  const to = options.to ?? MOJO_CALL_BACKFILL_TO
  const listed = await listAllMojoCalls(options.source, from, to)
  const summary = summarizeMojoCallBackfill(listed.calls, from, to)
  const comparison = compareMojoCallBackfill(summary, from, to)
  if (!options.apply) {
    return { dryRun: true, calls: listed.calls.length, skippedUnkeyed: listed.skippedUnkeyed, summary, comparison, written: 0 }
  }
  if (!options.db) throw new Error('mojo_call_backfill_database_required')
  const written = await upsertCrmMojoCalls(options.db, listed.calls)
  return { dryRun: false, calls: listed.calls.length, skippedUnkeyed: listed.skippedUnkeyed, summary, comparison, written: written.length }
}
