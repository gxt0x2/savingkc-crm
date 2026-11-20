import 'server-only'

/**
 * On-demand Twilio Lookup v2 checks for the CRM MCP tool.
 *
 * Each billable number is one Lookup with the same fields lookupPhoneLine
 * requests: line_status and line_type_intelligence. Line status is $0.007
 * and line type intelligence is $0.008, so the booked price is $0.015.
 * The America/Chicago daily count is the sum of assistant_query_audit
 * result_count for this action. That table already exists, so the
 * 1,000-lookup cap does not need a migration. Audit rows store the count
 * only: phone numbers are not written, and this module does not write
 * prospect, phone, DNC, opt-out, or TCPA records.
 */
import {
  assistantActorCanReadCompanyWide,
  type AssistantActor,
} from '@/lib/assistant/auth'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { externalSideEffectsDisabled } from '@/lib/preview-safety'
import { parseTwilioLookupPayload, type MappedLineStatus } from '@/lib/server/phone-line-check'
import { PHONE_LINE_LOOKUP_FIELDS } from '@/lib/server/phone-line-lookup-fields'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const CRM_LINE_TYPE_LOOKUP_TOOL = 'crm_line_type_lookup'
export const LINE_TYPE_LOOKUP_PATH = '/api/ops/line-type-lookup'
export const LINE_TYPE_LOOKUP_AUDIT_ACTION = 'mcp:line_type_lookup'
export const LINE_TYPE_LOOKUP_DAILY_CAP = 1000
export const LINE_TYPE_LOOKUP_MAX_PHONES = 200
export const LINE_TYPE_LOOKUP_CONCURRENCY = 5
export const LINE_STATUS_LOOKUP_PRICE_USD = 0.007
export const LINE_TYPE_INTELLIGENCE_PRICE_USD = 0.008
export const LINE_TYPE_LOOKUP_PRICE_USD = 0.015
export const LINE_TYPE_LOOKUP_FIELDS = PHONE_LINE_LOOKUP_FIELDS

const LOOKUP_TIMEOUT_MS = 8_000
const LOOKUP_ATTEMPTS = 4
const RETRY_BACKOFF_MS = [200, 400, 800]
const MAX_RETRY_DELAY_MS = 2_000
const CHICAGO = 'America/Chicago'
const CSV_HEADER = 'e164,valid,line_type,carrier,checked_at,line_status,line_status_error'
const LINE_TYPES = ['mobile', 'landline', 'fixedVoip', 'nonFixedVoip', 'tollFree'] as const

export type LineType = (typeof LINE_TYPES)[number] | 'unknown'

export type LineTypeLookupRow = {
  e164: string
  valid: boolean
  line_type: LineType
  carrier: string
  checked_at: string
  line_status: MappedLineStatus
  line_status_error: string | null
  error: string | null
}

export type LineTypeLookupUsage = {
  timezone: 'America/Chicago'
  day: string
  limit: number
  usedToday: number | null
  remaining: number | null
  counted: number
  costGuard: 'daily_cap' | 'per_call_max'
  pricePerLookupUsd: number
}

export type LineTypeLookupBody = {
  ok: boolean
  error?: string
  message?: string
  missing?: string[]
  rows?: LineTypeLookupRow[]
  csv?: string
  usage?: LineTypeLookupUsage
}

type AuditRow = {
  request_id: string
  result_count: number | null
}

type AuditError = { code?: string, message?: string } | null

export type LineTypeLookupAuditQuery = {
  select: (columns: string) => LineTypeLookupAuditQuery
  eq: (column: string, value: unknown) => LineTypeLookupAuditQuery
  gte: (column: string, value: string) => LineTypeLookupAuditQuery
  order: (column: string, options: { ascending: boolean }) => LineTypeLookupAuditQuery
  range: (from: number, to: number) => PromiseLike<{ data: AuditRow[] | null, error: AuditError }>
  insert: (row: Record<string, unknown>) => PromiseLike<{ error: AuditError }>
}

export type LineTypeLookupAuditDb = {
  from: (table: string) => LineTypeLookupAuditQuery
}

type LookupHit = {
  valid: boolean
  lineType: LineType
  carrier: string
  lineStatus: MappedLineStatus
  lineStatusError: string | null
  error: string | null
  checkedAt: string
}

export type LineTypeLookupDeps = {
  env?: LineTypeLookupEnv
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  db?: LineTypeLookupAuditDb
  sideEffectsDisabled?: boolean
}

type TwilioCredentials = {
  accountSid: string
  username: string
  password: string
}

type LineTypeLookupEnv = Record<string, string | undefined>

function cleanEnv(env: LineTypeLookupEnv, name: string): string {
  return env[name]?.replace(/\\[rnt]/g, '').replace(/\s+/g, '').trim() ?? ''
}

export function readLineTypeLookupCredentials(
  env: LineTypeLookupEnv = process.env,
): { ok: true, credentials: TwilioCredentials } | { ok: false, missing: string[], message: string } {
  const accountSid = cleanEnv(env, 'TWILIO_ACCOUNT_SID')
  const apiKey = cleanEnv(env, 'TWILIO_API_KEY')
  const apiSecret = cleanEnv(env, 'TWILIO_API_SECRET')
  const authToken = cleanEnv(env, 'TWILIO_AUTH_TOKEN')
  const hasKeyPair = Boolean(apiKey && apiSecret)
  const hasToken = Boolean(authToken)
  const message = 'Twilio Lookup credentials are missing. Set TWILIO_ACCOUNT_SID and either TWILIO_API_KEY and TWILIO_API_SECRET, or TWILIO_AUTH_TOKEN.'
  if (!accountSid || (!hasKeyPair && !hasToken)) {
    const missing = [
      !accountSid ? 'TWILIO_ACCOUNT_SID' : null,
      !hasKeyPair && !hasToken ? 'TWILIO_API_KEY' : null,
      !hasKeyPair && !hasToken ? 'TWILIO_API_SECRET' : null,
      !hasKeyPair && !hasToken ? 'TWILIO_AUTH_TOKEN' : null,
    ].filter((name): name is string => Boolean(name))
    return { ok: false, missing, message }
  }
  if (hasKeyPair) return { ok: true, credentials: { accountSid, username: apiKey, password: apiSecret } }
  return { ok: true, credentials: { accountSid, username: accountSid, password: authToken } }
}

export function chicagoDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function chicagoOffset(at: Date): string {
  const zoneName = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO,
    timeZoneName: 'longOffset',
  }).formatToParts(at).find((part) => part.type === 'timeZoneName')?.value
  const offset = zoneName?.match(/^GMT([+-]\d{2}:\d{2})$/)?.[1]
  if (!offset) throw new Error('America/Chicago offset unavailable')
  return offset
}

/** Midnight at the start of the America/Chicago civil day containing `now`. */
export function chicagoDayStart(now: Date): Date {
  const day = chicagoDate(now)
  const guess = new Date(`${day}T00:00:00${chicagoOffset(new Date(`${day}T12:00:00Z`))}`)
  return new Date(`${day}T00:00:00${chicagoOffset(guess)}`)
}

export function mapLookupLineType(value: unknown): LineType {
  const key = String(value ?? '').trim().toLowerCase()
  return LINE_TYPES.find((type) => type.toLowerCase() === key) ?? 'unknown'
}

function parsePhones(value: unknown): { ok: true, phones: string[] } | { ok: false, message: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, message: 'phones must be a non-empty list of phone numbers.' }
  }
  if (value.length > LINE_TYPE_LOOKUP_MAX_PHONES) {
    return { ok: false, message: `phones accepts at most ${LINE_TYPE_LOOKUP_MAX_PHONES} numbers per call.` }
  }
  if (value.some((phone) => typeof phone !== 'string' || phone.trim().length === 0 || phone.trim().length > 40)) {
    return { ok: false, message: 'Each phone must be a string of 1 to 40 characters.' }
  }
  return { ok: true, phones: value.map((phone) => phone.trim()) }
}

function csvCell(value: string): string {
  if (/^[=+\-@]/.test(value) || /[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function lineTypeLookupCsv(rows: LineTypeLookupRow[]): string {
  const lines = rows.map((row) => [
    csvCell(row.e164),
    row.valid ? 'true' : 'false',
    csvCell(row.line_type),
    csvCell(row.carrier),
    csvCell(row.checked_at),
    csvCell(row.line_status),
    csvCell(row.line_status_error ?? ''),
  ].join(','))
  return `${CSV_HEADER}\n${lines.join('\n')}${lines.length ? '\n' : ''}`
}

function usage(input: {
  day: string
  limit: number
  usedToday: number | null
  counted: number
  costGuard: LineTypeLookupUsage['costGuard']
}): LineTypeLookupUsage {
  return {
    timezone: 'America/Chicago',
    day: input.day,
    limit: input.limit,
    usedToday: input.usedToday,
    remaining: input.usedToday === null ? null : Math.max(0, input.limit - input.usedToday),
    counted: input.counted,
    costGuard: input.costGuard,
    pricePerLookupUsd: LINE_TYPE_LOOKUP_PRICE_USD,
  }
}

function missingTable(error: AuditError): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

async function listReservations(
  db: LineTypeLookupAuditDb,
  startIso: string,
): Promise<{ ok: true, rows: AuditRow[] } | { ok: false, missing: boolean, message: string }> {
  const rows: AuditRow[] = []
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await db
      .from('assistant_query_audit')
      .select('request_id, result_count')
      .eq('action', LINE_TYPE_LOOKUP_AUDIT_ACTION)
      .eq('success', true)
      .gte('created_at', startIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) {
      return {
        ok: false,
        missing: missingTable(error),
        message: 'Line type lookup counter is unavailable.',
      }
    }
    const page = data ?? []
    rows.push(...page)
    if (page.length < 1000) break
  }
  return { ok: true, rows }
}

function countOf(rows: AuditRow[]): number {
  return rows.reduce((total, row) => {
    const count = Number(row.result_count)
    return total + (Number.isFinite(count) ? count : 0)
  }, 0)
}

function priorCount(rows: AuditRow[], requestId: string): number | null {
  let total = 0
  for (const row of rows) {
    if (row.request_id === requestId) return total
    const count = Number(row.result_count)
    total += Number.isFinite(count) ? count : 0
  }
  return null
}

async function insertReservation(
  db: LineTypeLookupAuditDb,
  row: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false, missing: boolean }> {
  const { error } = await db.from('assistant_query_audit').insert(row)
  if (!error) return { ok: true }
  return { ok: false, missing: missingTable(error) }
}

function auditRow(input: {
  actor: AssistantActor
  requestId: string
  threadId?: string
  resultCount: number
  durationMs: number
  error?: string
}) {
  return {
    actor_email: input.actor.email,
    actor_access: input.actor.access,
    action: LINE_TYPE_LOOKUP_AUDIT_ACTION,
    request_id: input.requestId.slice(0, 160),
    thread_id: input.threadId || null,
    success: true,
    result_count: input.resultCount,
    duration_ms: Math.max(0, input.durationMs),
    error: input.error ?? null,
  }
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1000), MAX_RETRY_DELAY_MS)
  return RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]
}

function carrierName(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.slice(0, 200)
}

function statusErrorText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value))
  if (typeof value === 'string') {
    const code = value.trim()
    return code ? code.slice(0, 64) : null
  }
  return null
}

function failedHit(error: string, checkedAt: string): LookupHit {
  return {
    valid: false,
    lineType: 'unknown',
    carrier: '',
    lineStatus: 'unknown',
    lineStatusError: null,
    error,
    checkedAt,
  }
}

function parseLookupBody(body: unknown, checkedAt: string): LookupHit {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : null
  if (!record || typeof record.valid !== 'boolean') return failedHit('lookup_failed', checkedAt)
  const parsed = parseTwilioLookupPayload(record)
  const intelligence = (record.line_type_intelligence ?? record.lineTypeIntelligence) as Record<string, unknown> | null
  const carrier = carrierName(intelligence?.carrier_name ?? intelligence?.carrierName)
  const lineType = mapLookupLineType(intelligence?.type ?? intelligence?.Type)
  const lineStatusError = statusErrorText(parsed.raw.line_status_error_code)
  const typeError = intelligence?.error_code ?? intelligence?.errorCode
  if (typeError !== null && typeError !== undefined && String(typeError).trim()) {
    const code = String(typeError).trim()
    return {
      valid: record.valid,
      lineType: 'unknown',
      carrier,
      lineStatus: parsed.mappedStatus,
      lineStatusError,
      error: /^\d{1,6}$/.test(code) ? `line_type_${code}` : 'line_type_error',
      checkedAt,
    }
  }
  return {
    valid: record.valid,
    lineType,
    carrier,
    lineStatus: parsed.mappedStatus,
    lineStatusError,
    error: null,
    checkedAt,
  }
}

async function lookupNumber(input: {
  e164: string
  credentials: TwilioCredentials
  fetchImpl: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => Date
}): Promise<LookupHit> {
  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(input.e164)}?Fields=${LINE_TYPE_LOOKUP_FIELDS}`
  const authorization = `Basic ${Buffer.from(`${input.credentials.username}:${input.credentials.password}`).toString('base64')}`
  for (let attempt = 0; attempt < LOOKUP_ATTEMPTS; attempt += 1) {
    const checkedAt = input.now().toISOString()
    try {
      const response = await input.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: authorization, Accept: 'application/json' },
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      })
      const text = await response.text()
      if (response.status === 429 && attempt < LOOKUP_ATTEMPTS - 1) {
        await input.sleep(retryDelay(attempt, response.headers.get('retry-after')))
        continue
      }
      if (response.status === 429) return failedHit('rate_limited', checkedAt)
      if (response.status === 404) return failedHit('not_found', checkedAt)
      if (response.status < 200 || response.status >= 300) return failedHit('lookup_failed', checkedAt)
      return parseLookupBody(JSON.parse(text.slice(0, 100_000)), checkedAt)
    } catch {
      return failedHit('lookup_failed', checkedAt)
    }
  }
  return failedHit('lookup_failed', input.now().toISOString())
}

async function mapPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index] as T)
    }
  })
  await Promise.all(runners)
  return results
}

function rowFromHit(e164: string, hit: LookupHit): LineTypeLookupRow {
  return {
    e164,
    valid: hit.valid,
    line_type: hit.lineType,
    carrier: hit.carrier,
    checked_at: hit.checkedAt,
    line_status: hit.lineStatus,
    line_status_error: hit.lineStatusError,
    error: hit.error,
  }
}

export async function runLineTypeLookup(input: {
  actor: AssistantActor
  phones: unknown
  threadId?: string
  requestId?: string
  deps?: LineTypeLookupDeps
}): Promise<{ status: number, body: LineTypeLookupBody }> {
  if (!assistantActorCanReadCompanyWide(input.actor)) {
    return {
      status: 403,
      body: { ok: false, error: 'forbidden', message: 'Company-wide access requires an owner or admin profile.' },
    }
  }

  const parsed = parsePhones(input.phones)
  if (!parsed.ok) return { status: 400, body: { ok: false, error: 'invalid_request', message: parsed.message } }

  const now = input.deps?.now ?? (() => new Date())
  const checkedAt = now().toISOString()
  const normalized = parsed.phones.map((phone) => ({ input: phone, e164: normalizePhoneToE164(phone) }))
  const unique = [...new Set(normalized.flatMap((phone) => phone.e164 ? [phone.e164] : []))]
  const day = chicagoDate(now())
  const db = input.deps?.db ?? (supabaseAdmin() as unknown as LineTypeLookupAuditDb)
  const startedAt = now().getTime()

  if (unique.length === 0) {
    const startIso = chicagoDayStart(now()).toISOString()
    const existing = await listReservations(db, startIso)
    const rows = normalized.map((phone) => rowFromHit(phone.input, failedHit('invalid_phone', checkedAt)))
    return {
      status: 200,
      body: {
        ok: true,
        rows,
        csv: lineTypeLookupCsv(rows),
        usage: usage({
          day,
          limit: LINE_TYPE_LOOKUP_DAILY_CAP,
          usedToday: existing.ok ? countOf(existing.rows) : null,
          counted: 0,
          costGuard: existing.ok ? 'daily_cap' : 'per_call_max',
        }),
      },
    }
  }

  const sideEffectsDisabled = input.deps?.sideEffectsDisabled ?? externalSideEffectsDisabled()
  if (sideEffectsDisabled) {
    return {
      status: 503,
      body: {
        ok: false,
        error: 'external_side_effects_disabled',
        message: 'Twilio Lookup runs only in production.',
      },
    }
  }

  const credentials = readLineTypeLookupCredentials(input.deps?.env ?? process.env)
  if (!credentials.ok) {
    return {
      status: 503,
      body: {
        ok: false,
        error: 'twilio_not_configured',
        missing: credentials.missing,
        message: credentials.message,
      },
    }
  }

  const startIso = chicagoDayStart(now()).toISOString()
  const existing = await listReservations(db, startIso)
  let costGuard: LineTypeLookupUsage['costGuard'] = 'daily_cap'
  let limit = LINE_TYPE_LOOKUP_DAILY_CAP
  let usedBefore = 0

  if (!existing.ok) {
    if (!existing.missing) {
      return { status: 503, body: { ok: false, error: 'counter_unavailable', message: existing.message } }
    }
    costGuard = 'per_call_max'
    limit = LINE_TYPE_LOOKUP_MAX_PHONES
    if (unique.length > LINE_TYPE_LOOKUP_MAX_PHONES) {
      return {
        status: 429,
        body: {
          ok: false,
          error: 'per_call_max',
          message: `Daily lookup counter is unavailable, so a call is limited to ${LINE_TYPE_LOOKUP_MAX_PHONES} numbers.`,
          usage: usage({ day, limit, usedToday: null, counted: 0, costGuard }),
        },
      }
    }
  } else {
    usedBefore = countOf(existing.rows)
    if (usedBefore + unique.length > LINE_TYPE_LOOKUP_DAILY_CAP) {
      return {
        status: 429,
        body: {
          ok: false,
          error: 'daily_lookup_cap',
          message: `This request would pass today's ${LINE_TYPE_LOOKUP_DAILY_CAP} Twilio Lookup checks.`,
          usage: usage({
            day,
            limit,
            usedToday: usedBefore,
            counted: 0,
            costGuard,
          }),
        },
      }
    }

    const reservationId = input.requestId?.trim()
      ? `${input.requestId.trim()}:${crypto.randomUUID()}`.slice(0, 160)
      : crypto.randomUUID()
    const reserved = await insertReservation(db, auditRow({
      actor: input.actor,
      requestId: reservationId,
      threadId: input.threadId,
      resultCount: unique.length,
      durationMs: Math.max(0, now().getTime() - startedAt),
    }))
    if (!reserved.ok) {
      if (!reserved.missing) {
        return { status: 503, body: { ok: false, error: 'counter_unavailable', message: 'Line type lookup counter is unavailable.' } }
      }
      costGuard = 'per_call_max'
      limit = LINE_TYPE_LOOKUP_MAX_PHONES
    } else {
      const confirmed = await listReservations(db, startIso)
      if (!confirmed.ok) {
        return { status: 503, body: { ok: false, error: 'counter_unavailable', message: confirmed.message } }
      }
      const prior = priorCount(confirmed.rows, reservationId)
      if (prior === null) {
        return {
          status: 503,
          body: { ok: false, error: 'counter_unavailable', message: 'Line type lookup counter is unavailable.' },
        }
      }
      if (prior + unique.length > LINE_TYPE_LOOKUP_DAILY_CAP) {
        await insertReservation(db, auditRow({
          actor: input.actor,
          requestId: `${reservationId}:release`.slice(0, 160),
          threadId: input.threadId,
          resultCount: -unique.length,
          durationMs: Math.max(0, now().getTime() - startedAt),
          error: 'cap_race_released',
        }))
        const released = await listReservations(db, startIso)
        const usedToday = released.ok ? countOf(released.rows) : prior
        return {
          status: 429,
          body: {
            ok: false,
            error: 'daily_lookup_cap',
            message: `This request would pass today's ${LINE_TYPE_LOOKUP_DAILY_CAP} Twilio Lookup checks.`,
            usage: usage({ day, limit, usedToday, counted: 0, costGuard }),
          },
        }
      }
      usedBefore = prior
    }
  }

  const fetchImpl = input.deps?.fetchImpl ?? fetch
  const sleep = input.deps?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const hits = await mapPool(unique, LINE_TYPE_LOOKUP_CONCURRENCY, (e164) => lookupNumber({
    e164,
    credentials: credentials.credentials,
    fetchImpl,
    sleep,
    now,
  }))
  const byPhone = new Map(unique.map((e164, index) => [e164, hits[index]]))
  const rows = normalized.map((phone) => {
    if (!phone.e164) return rowFromHit(phone.input, failedHit('invalid_phone', checkedAt))
    return rowFromHit(phone.e164, byPhone.get(phone.e164) as LookupHit)
  })

  let usedToday: number | null = costGuard === 'per_call_max' ? null : usedBefore + unique.length
  if (costGuard === 'daily_cap') {
    const latest = await listReservations(db, startIso)
    if (latest.ok) usedToday = countOf(latest.rows)
  }

  return {
    status: 200,
    body: {
      ok: true,
      rows,
      csv: lineTypeLookupCsv(rows),
      usage: usage({
        day,
        limit,
        usedToday,
        counted: unique.length,
        costGuard,
      }),
      ...(costGuard === 'per_call_max'
        ? { message: `Daily lookup counter is unavailable, so only the per-call maximum of ${LINE_TYPE_LOOKUP_MAX_PHONES} is enforced.` }
        : {}),
    },
  }
}
