/**
 * Twilio Lookup v2 line check.
 *
 * Status names are the Line Status values Twilio documents
 * (Active, Reachable, Unreachable, Inactive, Unknown). The JSON example uses
 * lowercase; we accept either case. Reachable is a live line, so it maps to
 * active. Inactive is the Lookup-only disconnected result.
 *
 * Type names are the Line Type Intelligence values, stored with Twilio's
 * spelling (fixedVoip, nonFixedVoip, tollFree, sharedCost).
 *
 * Published price, October 2026, first volume tier: line status $0.007 plus
 * line type intelligence $0.008 = $0.015 per check. The database function is
 * the writer and uses this same price for the hard caps.
 *
 * Counsel rules (Pat, 2026-11-14) are applied in
 * public.apply_phone_line_checks_v1. decidePhoneLineCheck mirrors that
 * function so the branches stay reviewable here.
 */

export const PHONE_LINE_CHECK_COST_USD = 0.015
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

export type RndResult = 'unavailable' | 'clear' | 'permanent_disconnect'

export type LineCheckDecision = {
  lineStatus: StoredLineStatus
  reason: LineCheckReason
  recheckCount: number
  staleActiveExport: boolean
  fillPhoneConnected: boolean
  rnd: RndResult | null
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

export function decidePhoneLineCheck(input: {
  mappedStatus: MappedLineStatus
  failed: boolean
  priorStatus: StoredLineStatus | null
  priorCheckedAt: Date | null
  recheckCount: number
  dialDisconnected: boolean
  rnd: RndResult
  now: Date
}): LineCheckDecision {
  const priorCount = Number.isFinite(input.recheckCount) ? Math.max(0, input.recheckCount) : 0
  if (input.dialDisconnected) {
    return {
      lineStatus: 'suppressed_bad_number',
      reason: 'dial_disconnect',
      recheckCount: priorCount,
      staleActiveExport: false,
      fillPhoneConnected: false,
      rnd: null,
    }
  }
  if (input.priorStatus === 'suppressed_bad_number') {
    return {
      lineStatus: 'suppressed_bad_number',
      reason: 'permanent_bad_number',
      recheckCount: priorCount,
      staleActiveExport: false,
      fillPhoneConnected: false,
      rnd: null,
    }
  }

  const failed = input.failed || input.mappedStatus === 'unknown'
  if (failed) {
    const freshActive = input.priorStatus === 'active'
      && input.priorCheckedAt !== null
      && input.priorCheckedAt.getTime() >= input.now.getTime() - PHONE_LINE_STALE_ACTIVE_DAYS * 24 * 60 * 60 * 1000
    if (freshActive) {
      return {
        lineStatus: 'active',
        reason: 'check_failed_stale_active',
        recheckCount: priorCount,
        staleActiveExport: true,
        fillPhoneConnected: false,
        rnd: null,
      }
    }
    return {
      lineStatus: 'unknown',
      reason: 'check_failed',
      recheckCount: priorCount,
      staleActiveExport: false,
      fillPhoneConnected: false,
      rnd: null,
    }
  }

  if (input.mappedStatus === 'unreachable') {
    return {
      lineStatus: 'unreachable',
      reason: 'unreachable_hold',
      recheckCount: priorCount,
      staleActiveExport: false,
      fillPhoneConnected: false,
      rnd: null,
    }
  }

  if (input.mappedStatus === 'inactive') {
    if (input.priorStatus === 'suppressed_lookup_inactive') {
      const nextCount = priorCount + 1
      if (nextCount >= PHONE_LINE_MAX_RECHECKS) {
        return {
          lineStatus: 'suppressed_bad_number',
          reason: 'recheck_still_inactive',
          recheckCount: nextCount,
          staleActiveExport: false,
          fillPhoneConnected: false,
          rnd: null,
        }
      }
      return {
        lineStatus: 'suppressed_lookup_inactive',
        reason: 'lookup_inactive',
        recheckCount: nextCount,
        staleActiveExport: false,
        fillPhoneConnected: false,
        rnd: null,
      }
    }
    return {
      lineStatus: 'suppressed_lookup_inactive',
      reason: 'lookup_inactive',
      recheckCount: 0,
      staleActiveExport: false,
      fillPhoneConnected: false,
      rnd: null,
    }
  }

  if (input.priorStatus === 'suppressed_lookup_inactive') {
    if (input.rnd === 'clear') {
      return {
        lineStatus: 'active',
        reason: 'recheck_active_rnd_clear',
        recheckCount: 0,
        staleActiveExport: false,
        fillPhoneConnected: true,
        rnd: 'clear',
      }
    }
    return {
      lineStatus: 'suppressed_bad_number',
      reason: input.rnd === 'permanent_disconnect'
        ? 'rnd_permanent_disconnect'
        : 'recheck_active_rnd_unavailable',
      recheckCount: priorCount,
      staleActiveExport: false,
      fillPhoneConnected: false,
      rnd: input.rnd,
    }
  }

  return {
    lineStatus: 'active',
    reason: 'lookup_active',
    recheckCount: 0,
    staleActiveExport: false,
    fillPhoneConnected: true,
    rnd: null,
  }
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
  selectCandidates(input: {
    limit: number
    sourceListId: string | null
    prospectPhoneIds: string[] | null
  }): Promise<LineCheckSelection>
  applyChecks(input: {
    results: LineCheckWrite[]
    source: 'cron' | 'manual'
    actor: string
    reportCap: boolean
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
  let checked = 0
  let failed = 0
  let stopped = false
  let cap: string | null = null
  let remaining = 0
  const skipped: LineCheckSkip[] = []
  const attempted = new Set<string>()

  while (now() < deadline) {
    const selection = await input.store.selectCandidates({
      limit: batchSize,
      sourceListId: input.sourceListId ?? null,
      prospectPhoneIds: input.prospectPhoneIds ?? null,
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
    costUsd: Number((checked * PHONE_LINE_CHECK_COST_USD).toFixed(4)),
    remaining,
  }
}
