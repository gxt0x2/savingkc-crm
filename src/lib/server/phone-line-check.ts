/**
 * Twilio Lookup v2 line check.
 *
 * Status names are the Line Status values Twilio documents
 * (Active, Reachable, Unreachable, Inactive, Unknown). The JSON example uses
 * lowercase; we accept either case. Reachable is a live line, so it maps to
 * active. Inactive is the Lookup-only disconnected result.
 *
 * Type names are the Line Type Intelligence values, stored with Twilio's
 * spelling (fixedVoip, nonFixedVoip, tollFree, sharedCost). Line type is not
 * consent. Counsel ruling §4a, 2026-11-14 (Lookup inactive).
 *
 * The per-check price comes from LINE_CHECK_COST_USD. The database function
 * reads the same value after the app stores it, and it reserves that spend
 * before any Lookup call.
 *
 * decidePhoneLineCheck mirrors public.phone_line_decide_v1.
 */

export const PHONE_LINE_DAILY_PHONE_CAP = 1500
export const PHONE_LINE_DAILY_COST_CAP_USD = 15
export const PHONE_LINE_MONTHLY_COST_CAP_USD = 60
export const PHONE_LINE_RECHECK_DAYS = 30
export const PHONE_LINE_UNREACHABLE_RECHECK_DAYS = 7
export const PHONE_LINE_FAILED_RETRY_DAYS = 1
export const PHONE_LINE_STALE_ACTIVE_DAYS = 90
export const PHONE_LINE_MAX_RECHECKS = 2

export const TWILIO_LINE_STATUS_VALUES = [
  'Active',
  'Reachable',
  'Unreachable',
  'Inactive',
  'Unknown',
] as const

export const TWILIO_LINE_TYPE_VALUES = [
  'landline',
  'mobile',
  'fixedVoip',
  'nonFixedVoip',
  'personal',
  'tollFree',
  'premium',
  'sharedCost',
  'uan',
  'voicemail',
  'pager',
  'unknown',
] as const

const LINE_TYPE_BY_KEY = new Map(
  TWILIO_LINE_TYPE_VALUES.map((value) => [value.toLowerCase(), value]),
)

export type MappedLineStatus = 'active' | 'inactive' | 'unreachable' | 'unknown'
export type StoredLineStatus =
  | 'active'
  | 'unreachable'
  | 'unknown'
  | 'suppressed_lookup_inactive'
  | 'suppressed_bad_number'

export type LineCheckReason =
  | 'lookup_inactive'
  | 'lookup_active'
  | 'unreachable_hold'
  | 'recheck_still_inactive'
  | 'recheck_active_rnd_unavailable'
  | 'recheck_active_rnd_clear'
  | 'rnd_permanent_disconnect'
  | 'dial_disconnect'
  | 'check_failed'
  | 'check_failed_stale_active'
  | 'permanent_bad_number'
  | 'calling_window_lock'

export type RndResult = 'unavailable' | 'clear' | 'permanent_disconnect'

export type LineCheckDecision = {
  lineStatus: StoredLineStatus
  reason: LineCheckReason
  recheckCount: number
  staleActiveExport: boolean
  fillPhoneConnected: boolean
  touchLastActive: boolean
  keepPriorStatus: boolean
  rnd: RndResult | null
}

export class LineCheckConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LineCheckConfigError'
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

export function lineCheckCostUsd(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LINE_CHECK_COST_USD?.trim()
  if (!raw) throw new LineCheckConfigError('LINE_CHECK_COST_USD is not configured')
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new LineCheckConfigError('LINE_CHECK_COST_USD is invalid')
  }
  return Math.round(value * 10000) / 10000
}

export function lineCheckBlockEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = (env.LINE_CHECK_BLOCK_ENABLED ?? '').trim().toLowerCase()
  return raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes'
}

export function lineCheckFreshReserveUsd(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LINE_CHECK_FRESH_RESERVE_USD?.trim()
  if (!raw) return 5
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > PHONE_LINE_DAILY_COST_CAP_USD) {
    throw new LineCheckConfigError('LINE_CHECK_FRESH_RESERVE_USD is invalid')
  }
  return Math.round(value * 100) / 100
}

export function chicagoHour(now: Date): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now).find((part) => part.type === 'hour')?.value
  return Number(hour ?? '0')
}

/** 04:00 inclusive through 21:00 exclusive, America/Chicago. */
export function lineCheckSuppressOnly(now: Date): boolean {
  const hour = chicagoHour(now)
  return hour >= 4 && hour < 21
}

export type LineCheckLane = 'fresh_intake' | 'tier_1' | 'backfill'

export function lineCheckLane(input: {
  lineCheckedAt: Date | null
  listPullDate: string | null
  rowCreatedAt: Date | null
  rowStatus: string
  today: string
}): LineCheckLane {
  const createdToday = input.rowCreatedAt !== null
    && chicagoDate(input.rowCreatedAt) === input.today
  if (input.lineCheckedAt === null && (input.listPullDate === input.today || createdToday)) {
    return 'fresh_intake'
  }
  if (input.rowStatus === 'loaded_to_dialer') return 'tier_1'
  return 'backfill'
}

export function chicagoDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

const SKIP_CLASSES = new Set([
  'prospect_dnc',
  'person_dnc',
  'lead_dnc',
  'mojo_dnc',
  'disconnected',
  'dead_number',
  'wrong_number',
])

export function lineCheckSkippedByClass(classes: Array<string | null | undefined>): boolean {
  return classes.some((value) => typeof value === 'string' && SKIP_CLASSES.has(value))
}

export function lineCheckExportBlock(input: {
  lineStatus: string | null
  lineCheckedAt: Date | null
  lineLastActiveAt: Date | null
  now: Date
  blockEnabled: boolean
}): string | null {
  if (!input.blockEnabled) return null
  if (input.lineStatus === 'suppressed_bad_number') return 'suppressed_bad_number'
  if (input.lineStatus === 'suppressed_lookup_inactive') return 'suppressed_lookup_inactive'
  if (input.lineStatus === 'unreachable') return 'line_status_unreachable'
  if (!input.lineCheckedAt) return 'line_check_unknown'
  const fresh = input.lineLastActiveAt !== null
    && input.lineLastActiveAt.getTime() >= input.now.getTime() - PHONE_LINE_STALE_ACTIVE_DAYS * DAY_MS
  if (!fresh) return 'line_check_stale'
  return null
}

function scheduledRecheck(suppressedAt: Date | null, recheckCount: number, now: Date): boolean {
  if (!suppressedAt) return false
  const waitDays = recheckCount <= 0 ? PHONE_LINE_RECHECK_DAYS : PHONE_LINE_RECHECK_DAYS * 2
  return suppressedAt.getTime() <= now.getTime() - waitDays * DAY_MS
}

function freshLastActive(lastActiveAt: Date | null, now: Date): boolean {
  return !!lastActiveAt
    && lastActiveAt.getTime() >= now.getTime() - PHONE_LINE_STALE_ACTIVE_DAYS * DAY_MS
}

const SMS_LINE_TYPES = new Set(['mobile', 'nonFixedVoip'])

export function mapTwilioLineStatus(value: unknown): MappedLineStatus {
  const status = String(value ?? '').trim().toLowerCase()
  if (status === 'active' || status === 'reachable') return 'active'
  if (status === 'inactive' || status === 'disconnected') return 'inactive'
  if (status === 'unreachable') return 'unreachable'
  return 'unknown'
}

export function mapTwilioLineType(value: unknown): string | null {
  const key = String(value ?? '').trim().toLowerCase()
  if (!key) return null
  return LINE_TYPE_BY_KEY.get(key) ?? 'unknown'
}

export function lineTypeAllowsSms(lineType: string | null | undefined): boolean {
  return SMS_LINE_TYPES.has(lineType ?? '')
}

function held(input: {
  lineStatus: StoredLineStatus
  reason: LineCheckReason
  recheckCount: number
  staleActiveExport?: boolean
  fillPhoneConnected?: boolean
  touchLastActive?: boolean
  keepPriorStatus?: boolean
  rnd?: RndResult | null
}): LineCheckDecision {
  return {
    lineStatus: input.lineStatus,
    reason: input.reason,
    recheckCount: input.recheckCount,
    staleActiveExport: input.staleActiveExport ?? false,
    fillPhoneConnected: input.fillPhoneConnected ?? false,
    touchLastActive: input.touchLastActive ?? false,
    keepPriorStatus: input.keepPriorStatus ?? false,
    rnd: input.rnd ?? null,
  }
}

export function decidePhoneLineCheck(input: {
  mappedStatus: MappedLineStatus
  failed: boolean
  priorStatus: StoredLineStatus | null
  priorCheckedAt: Date | null
  lastActiveAt: Date | null
  suppressedAt: Date | null
  recheckCount: number
  dialDisconnected: boolean
  rnd: RndResult
  now: Date
  suppressOnly?: boolean
}): LineCheckDecision {
  const priorCount = Number.isFinite(input.recheckCount) ? Math.max(0, input.recheckCount) : 0
  const decision = decideOpen(input, priorCount)
  if (!input.suppressOnly) return decision
  if (decision.lineStatus !== 'active' && !decision.touchLastActive && !decision.fillPhoneConnected) {
    return decision
  }
  return held({
    lineStatus: input.priorStatus ?? 'unknown',
    reason: 'calling_window_lock',
    recheckCount: priorCount,
    keepPriorStatus: true,
    rnd: decision.rnd,
  })
}

function decideOpen(input: {
  mappedStatus: MappedLineStatus
  failed: boolean
  priorStatus: StoredLineStatus | null
  priorCheckedAt: Date | null
  lastActiveAt: Date | null
  suppressedAt: Date | null
  dialDisconnected: boolean
  rnd: RndResult
  now: Date
}, priorCount: number): LineCheckDecision {
  if (input.dialDisconnected) {
    return held({ lineStatus: 'suppressed_bad_number', reason: 'dial_disconnect', recheckCount: priorCount })
  }
  if (input.priorStatus === 'suppressed_bad_number') {
    return held({ lineStatus: 'suppressed_bad_number', reason: 'permanent_bad_number', recheckCount: priorCount, keepPriorStatus: true })
  }

  const failed = input.failed || input.mappedStatus === 'unknown'
  if (input.priorStatus === 'suppressed_lookup_inactive') {
    const scheduled = scheduledRecheck(input.suppressedAt, priorCount, input.now)
    const qualifying = scheduled && !failed && input.mappedStatus !== 'unreachable'
    if (!qualifying) {
      return held({
        lineStatus: 'suppressed_lookup_inactive',
        reason: 'lookup_inactive',
        recheckCount: priorCount,
        keepPriorStatus: true,
      })
    }
    if (input.mappedStatus === 'inactive') {
      const nextCount = priorCount + 1
      if (nextCount >= PHONE_LINE_MAX_RECHECKS) {
        return held({ lineStatus: 'suppressed_bad_number', reason: 'recheck_still_inactive', recheckCount: nextCount })
      }
      return held({ lineStatus: 'suppressed_lookup_inactive', reason: 'lookup_inactive', recheckCount: nextCount })
    }
    if (input.rnd === 'clear') {
      return held({
        lineStatus: 'active',
        reason: 'recheck_active_rnd_clear',
        recheckCount: 0,
        fillPhoneConnected: true,
        touchLastActive: true,
        rnd: 'clear',
      })
    }
    return held({
      lineStatus: 'suppressed_bad_number',
      reason: input.rnd === 'permanent_disconnect' ? 'rnd_permanent_disconnect' : 'recheck_active_rnd_unavailable',
      recheckCount: priorCount,
      rnd: input.rnd === 'permanent_disconnect' ? 'permanent_disconnect' : 'unavailable',
    })
  }

  if (failed) {
    if (input.priorStatus === 'active' && freshLastActive(input.lastActiveAt, input.now)) {
      return held({
        lineStatus: 'active',
        reason: 'check_failed_stale_active',
        recheckCount: priorCount,
        staleActiveExport: true,
        keepPriorStatus: true,
      })
    }
    return held({ lineStatus: 'unknown', reason: 'check_failed', recheckCount: priorCount })
  }

  if (input.mappedStatus === 'unreachable') {
    return held({ lineStatus: 'unreachable', reason: 'unreachable_hold', recheckCount: priorCount })
  }
  if (input.mappedStatus === 'inactive') {
    return held({ lineStatus: 'suppressed_lookup_inactive', reason: 'lookup_inactive', recheckCount: 0 })
  }
  return held({
    lineStatus: 'active',
    reason: 'lookup_active',
    recheckCount: 0,
    fillPhoneConnected: true,
    touchLastActive: true,
  })
}

type LookupField = Record<string, unknown> | null | undefined

function field(record: LookupField, ...keys: string[]): unknown {
  if (!record) return null
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key]
  }
  return null
}

export type ParsedLookup = {
  mappedStatus: MappedLineStatus
  lineType: string | null
  twilioStatus: string | null
  twilioType: string | null
  failed: boolean
  raw: Record<string, unknown>
}

export function parseTwilioLookupPayload(payload: unknown): ParsedLookup {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const lineStatus = (record.lineStatus ?? record.line_status) as LookupField
  const lineType = (record.lineTypeIntelligence ?? record.line_type_intelligence) as LookupField
  const twilioStatus = field(lineStatus, 'status', 'Status')
  const twilioType = field(lineType, 'type', 'Type')
  const statusError = field(lineStatus, 'errorCode', 'error_code', 'ErrorCode')
  const typeError = field(lineType, 'errorCode', 'error_code', 'ErrorCode')
  const mappedStatus = mapTwilioLineStatus(twilioStatus)
  const failed = twilioStatus == null || mappedStatus === 'unknown'
  return {
    mappedStatus,
    lineType: mapTwilioLineType(twilioType),
    twilioStatus: twilioStatus == null ? null : String(twilioStatus),
    twilioType: twilioType == null ? null : String(twilioType),
    failed,
    raw: {
      twilio_status: twilioStatus == null ? null : String(twilioStatus),
      twilio_type: twilioType == null ? null : String(twilioType),
      line_status_error_code: statusError,
      line_type_error_code: typeError,
      valid: record.valid ?? null,
    },
  }
}

export type LineCheckCandidate = {
  phoneE164: string
  prospectPhoneId: string | null
}

export type LineCheckSkip = {
  prospectPhoneId: string | null
  reason: string
}

export type LineCheckSelection = {
  remaining: number
  cap: string | null
  candidates: LineCheckCandidate[]
  skipped: LineCheckSkip[]
}

export type LineCheckWrite = {
  phoneE164: string
  lineType: string | null
  lineStatus: MappedLineStatus
  failed: boolean
  raw: Record<string, unknown>
  checkedAt: string
}

export type LineCheckApplyResult = {
  accepted: number
  stopped: boolean
  cap: string | null
  batchSize: number
  phonesToday: number
  costTodayUsd: number
  costMonthUsd: number
}

export type PhoneLineCheckStore = {
  syncConfig(input: { costUsd: number; blockEnabled: boolean }): Promise<void>
  reserveCandidates(input: {
    limit: number
    sourceListId: string | null
    prospectPhoneIds: string[] | null
    freshReserveUsd: number
    source: 'cron' | 'manual'
    actor: string
  }): Promise<LineCheckSelection>
  applyChecks(input: {
    results: LineCheckWrite[]
    source: 'cron' | 'manual'
    actor: string
    reportCap: boolean
    suppressOnly: boolean
  }): Promise<LineCheckApplyResult>
}

export type PhoneLineLookup = (phoneE164: string) => Promise<ParsedLookup>

export type PhoneLineRunSummary = {
  ok: true
  source: 'cron' | 'manual'
  checked: number
  failed: number
  skipped: LineCheckSkip[]
  stopped: boolean
  cap: string | null
  costUsd: number
  remaining: number
  suppressOnly: boolean
  code: 'calling_window_suppress_only' | null
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parseLineCheckSelection(data: unknown): LineCheckSelection {
  const row = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const candidates = Array.isArray(row.candidates) ? row.candidates : []
  const skipped = Array.isArray(row.skipped) ? row.skipped : []
  return {
    remaining: numberValue(row.remaining),
    cap: textValue(row.cap),
    candidates: candidates.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const phoneE164 = textValue((item as Record<string, unknown>).phone_e164)
      if (!phoneE164) return []
      return [{
        phoneE164,
        prospectPhoneId: textValue((item as Record<string, unknown>).prospect_phone_id),
      }]
    }),
    skipped: skipped.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const reason = textValue((item as Record<string, unknown>).reason)
      if (!reason) return []
      return [{
        prospectPhoneId: textValue((item as Record<string, unknown>).prospect_phone_id),
        reason,
      }]
    }),
  }
}

export function parseLineCheckApplyResult(data: unknown): LineCheckApplyResult {
  const row = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  return {
    accepted: numberValue(row.accepted),
    stopped: row.stopped === true,
    cap: textValue(row.cap),
    batchSize: numberValue(row.batch_size),
    phonesToday: numberValue(row.phones_today),
    costTodayUsd: numberValue(row.cost_today_usd),
    costMonthUsd: numberValue(row.cost_month_usd),
  }
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

export async function runPhoneLineChecks(input: {
  store: PhoneLineCheckStore
  lookup: PhoneLineLookup
  source: 'cron' | 'manual'
  actor: string
  sourceListId?: string | null
  prospectPhoneIds?: string[] | null
  batchSize?: number
  concurrency?: number
  deadlineMs?: number
  now?: () => number
}): Promise<PhoneLineRunSummary> {
  const now = input.now ?? Date.now
  const deadline = input.deadlineMs ?? now() + 240_000
  const batchSize = Math.min(100, Math.max(1, input.batchSize ?? 40))
  const concurrency = Math.min(8, Math.max(1, input.concurrency ?? 8))
  const costUsd = lineCheckCostUsd()
  const suppressOnly = lineCheckSuppressOnly(new Date(now()))
  await input.store.syncConfig({ costUsd, blockEnabled: lineCheckBlockEnabled() })
  let checked = 0
  let failed = 0
  let stopped = false
  let cap: string | null = null
  let remaining = 0
  const skipped: LineCheckSkip[] = []
  const attempted = new Set<string>()

  while (now() < deadline) {
    const selection = await input.store.reserveCandidates({
      limit: batchSize,
      sourceListId: input.sourceListId ?? null,
      prospectPhoneIds: input.prospectPhoneIds ?? null,
      freshReserveUsd: lineCheckFreshReserveUsd(),
      source: input.source,
      actor: input.actor,
    })
    remaining = selection.remaining
    for (const candidate of selection.candidates) {
      if (candidate.prospectPhoneId) attempted.add(candidate.prospectPhoneId)
    }
    for (const skip of selection.skipped) {
      if (skip.prospectPhoneId && attempted.has(skip.prospectPhoneId)) continue
      if (skipped.some((existing) => existing.prospectPhoneId === skip.prospectPhoneId && existing.reason === skip.reason)) continue
      skipped.push(skip)
    }
    if (selection.candidates.length === 0) {
      if (selection.cap) {
        const applied = await input.store.applyChecks({
          results: [],
          source: input.source,
          actor: input.actor,
          reportCap: true,
          suppressOnly,
        })
        stopped = true
        cap = applied.cap ?? selection.cap
      }
      break
    }

    const writes = await mapPool(selection.candidates, concurrency, async (candidate) => {
      const checkedAt = new Date(now()).toISOString()
      try {
        const parsed = await input.lookup(candidate.phoneE164)
        if (parsed.failed) failed += 1
        return {
          phoneE164: candidate.phoneE164,
          lineType: parsed.lineType,
          lineStatus: parsed.mappedStatus,
          failed: parsed.failed,
          raw: parsed.raw,
          checkedAt,
        } satisfies LineCheckWrite
      } catch {
        failed += 1
        return {
          phoneE164: candidate.phoneE164,
          lineType: null,
          lineStatus: 'unknown' as const,
          failed: true,
          raw: { failed: true, twilio_status: null, twilio_type: null },
          checkedAt,
        } satisfies LineCheckWrite
      }
    })

    const applied = await input.store.applyChecks({
      results: writes,
      source: input.source,
      actor: input.actor,
      reportCap: false,
      suppressOnly,
    })
    checked += applied.accepted
    if (applied.stopped) {
      stopped = true
      cap = applied.cap
      break
    }
    if (selection.candidates.length < batchSize) break
  }

  return {
    ok: true,
    source: input.source,
    checked,
    failed,
    skipped,
    stopped,
    cap,
    costUsd: Number((checked * costUsd).toFixed(4)),
    remaining,
    suppressOnly,
    code: suppressOnly ? 'calling_window_suppress_only' : null,
  }
}
