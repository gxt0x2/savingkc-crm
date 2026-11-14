import { describe, expect, it, vi } from 'vitest'
import {
  decidePhoneLineCheck,
  lineCheckBlockEnabled,
  lineCheckCostUsd,
  lineCheckExportBlock,
  lineCheckLane,
  lineCheckSkippedByClass,
  lineCheckSuppressOnly,
  mapTwilioLineStatus,
  mapTwilioLineType,
  parseTwilioLookupPayload,
  runPhoneLineChecks,
  type PhoneLineCheckStore,
} from './phone-line-check'

const NOW = new Date('2026-11-14T18:30:00.000Z')
const DAY = 24 * 60 * 60 * 1000

describe('Twilio Lookup value mapping', () => {
  it('maps documented line status names, including the lowercase JSON example', () => {
    expect(mapTwilioLineStatus('Active')).toBe('active')
    expect(mapTwilioLineStatus('reachable')).toBe('active')
    expect(mapTwilioLineStatus('Unreachable')).toBe('unreachable')
    expect(mapTwilioLineStatus('Inactive')).toBe('inactive')
    expect(mapTwilioLineStatus('disconnected')).toBe('inactive')
    expect(mapTwilioLineStatus('Unknown')).toBe('unknown')
    expect(mapTwilioLineStatus(null)).toBe('unknown')
  })

  it('keeps Twilio line type spelling and treats other values as unknown', () => {
    expect(mapTwilioLineType('mobile')).toBe('mobile')
    expect(mapTwilioLineType('landline')).toBe('landline')
    expect(mapTwilioLineType('fixedVoip')).toBe('fixedVoip')
    expect(mapTwilioLineType('nonFixedVoip')).toBe('nonFixedVoip')
    expect(mapTwilioLineType('tollFree')).toBe('tollFree')
    expect(mapTwilioLineType('sharedCost')).toBe('sharedCost')
    expect(mapTwilioLineType('not-a-type')).toBe('unknown')
    expect(mapTwilioLineType('')).toBeNull()
  })

  it('reads the Lookup v2 field names', () => {
    expect(parseTwilioLookupPayload({
      valid: true,
      line_status: { status: 'Inactive', error_code: null },
      line_type_intelligence: { type: 'landline', error_code: null },
    })).toMatchObject({
      mappedStatus: 'inactive',
      lineType: 'landline',
      twilioStatus: 'Inactive',
      failed: false,
    })
    expect(parseTwilioLookupPayload({
      lineStatus: { status: 'reachable', errorCode: null },
      lineTypeIntelligence: { type: 'nonFixedVoip', errorCode: null },
    }).mappedStatus).toBe('active')
  })
})


const THIRTY = new Date(NOW.getTime() - 30 * DAY)
const SIXTY = new Date(NOW.getTime() - 60 * DAY)

function decision(overrides: Parameters<typeof decidePhoneLineCheck>[0]) {
  return decidePhoneLineCheck({
    mappedStatus: 'inactive',
    failed: false,
    priorStatus: null,
    priorCheckedAt: null,
    lastActiveAt: null,
    suppressedAt: null,
    recheckCount: 0,
    dialDisconnected: false,
    rnd: 'unavailable',
    now: NOW,
    suppressOnly: false,
    ...overrides,
  })
}

describe('counsel ruling §4a, 2026-11-14 (Lookup inactive)', () => {
  it('B1 keeps a soft suppress when a later result is unreachable or unknown', () => {
    const prior = {
      priorStatus: 'suppressed_lookup_inactive' as const,
      suppressedAt: new Date(NOW.getTime() - 10 * DAY),
      recheckCount: 0,
    }
    expect(decision({ ...prior, mappedStatus: 'unreachable' })).toMatchObject({
      lineStatus: 'suppressed_lookup_inactive',
      reason: 'lookup_inactive',
      recheckCount: 0,
      keepPriorStatus: true,
      touchLastActive: false,
    })
    expect(decision({ ...prior, mappedStatus: 'unknown', failed: true })).toMatchObject({
      lineStatus: 'suppressed_lookup_inactive',
      keepPriorStatus: true,
    })
    expect(decision({ ...prior, mappedStatus: 'active' })).toMatchObject({
      lineStatus: 'suppressed_lookup_inactive',
      keepPriorStatus: true,
      fillPhoneConnected: false,
    })
  })

  it('B1 lets only the 30- and 60-day recheck change a soft suppress', () => {
    expect(decision({
      mappedStatus: 'inactive',
      priorStatus: 'suppressed_lookup_inactive',
      suppressedAt: THIRTY,
      recheckCount: 0,
    })).toMatchObject({ lineStatus: 'suppressed_lookup_inactive', recheckCount: 1, keepPriorStatus: false })
    expect(decision({
      mappedStatus: 'inactive',
      priorStatus: 'suppressed_lookup_inactive',
      suppressedAt: SIXTY,
      recheckCount: 1,
    })).toMatchObject({ lineStatus: 'suppressed_bad_number', reason: 'recheck_still_inactive', recheckCount: 2 })
  })

  it('§4a keeps an active recheck suppressed unless RND is clear', () => {
    expect(decision({
      mappedStatus: 'active',
      priorStatus: 'suppressed_lookup_inactive',
      suppressedAt: THIRTY,
      recheckCount: 0,
      rnd: 'unavailable',
    })).toMatchObject({
      lineStatus: 'suppressed_bad_number',
      reason: 'recheck_active_rnd_unavailable',
      fillPhoneConnected: false,
      touchLastActive: false,
    })
    expect(decision({
      mappedStatus: 'active',
      priorStatus: 'suppressed_lookup_inactive',
      suppressedAt: THIRTY,
      recheckCount: 0,
      rnd: 'clear',
    })).toMatchObject({
      lineStatus: 'active',
      reason: 'recheck_active_rnd_clear',
      fillPhoneConnected: true,
      touchLastActive: true,
      rnd: 'clear',
    })
  })

  it('§4a never rechecks a dial-proven disconnect and does not treat line type as consent', () => {
    expect(decision({
      mappedStatus: 'active',
      dialDisconnected: true,
      rnd: 'clear',
    })).toMatchObject({
      lineStatus: 'suppressed_bad_number',
      reason: 'dial_disconnect',
      fillPhoneConnected: false,
      touchLastActive: false,
    })
    const active = decision({ mappedStatus: 'active' })
    expect(active).toMatchObject({ reason: 'lookup_active', touchLastActive: true })
    expect(active).not.toHaveProperty('consent')
    expect(lineCheckSkippedByClass(['disconnected'])).toBe(true)
    expect(lineCheckSkippedByClass(['prospect_dnc', 'allow'])).toBe(true)
    expect(lineCheckSkippedByClass(['allow', null])).toBe(false)
  })

  it('B2 does not rewrite status to active or bump freshness when the check fails', () => {
    expect(decision({
      mappedStatus: 'unknown',
      failed: true,
      priorStatus: 'active',
      lastActiveAt: new Date(NOW.getTime() - 10 * DAY),
    })).toMatchObject({
      lineStatus: 'active',
      reason: 'check_failed_stale_active',
      touchLastActive: false,
      keepPriorStatus: true,
      staleActiveExport: true,
    })
    expect(decision({
      mappedStatus: 'unknown',
      failed: true,
      priorStatus: 'active',
      lastActiveAt: new Date(NOW.getTime() - 91 * DAY),
    })).toMatchObject({
      lineStatus: 'unknown',
      reason: 'check_failed',
      touchLastActive: false,
      staleActiveExport: false,
    })
    expect(decision({ mappedStatus: 'active' }).touchLastActive).toBe(true)
  })

  it('B2 blocks export when the last real active result is outside 90 days', () => {
    expect(lineCheckBlockEnabled({})).toBe(false)
    expect(lineCheckExportBlock({
      lineStatus: 'active',
      lineCheckedAt: NOW,
      lineLastActiveAt: new Date(NOW.getTime() - 10 * DAY),
      now: NOW,
      blockEnabled: false,
    })).toBeNull()
    expect(lineCheckExportBlock({
      lineStatus: 'active',
      lineCheckedAt: NOW,
      lineLastActiveAt: new Date(NOW.getTime() - 10 * DAY),
      now: NOW,
      blockEnabled: true,
    })).toBeNull()
    expect(lineCheckExportBlock({
      lineStatus: 'active',
      lineCheckedAt: NOW,
      lineLastActiveAt: new Date(NOW.getTime() - 91 * DAY),
      now: NOW,
      blockEnabled: true,
    })).toBe('line_check_stale')
    expect(lineCheckExportBlock({
      lineStatus: null,
      lineCheckedAt: null,
      lineLastActiveAt: null,
      now: NOW,
      blockEnabled: true,
    })).toBe('line_check_unknown')
  })

  it('B6 refuses to make a phone exportable between 4am and 9pm Chicago', () => {
    expect(lineCheckSuppressOnly(new Date('2026-11-14T08:00:00.000Z'))).toBe(false)
    expect(lineCheckSuppressOnly(new Date('2026-11-14T16:00:00.000Z'))).toBe(true)
    expect(lineCheckSuppressOnly(new Date('2026-07-14T09:00:00.000Z'))).toBe(true)
    expect(lineCheckSuppressOnly(new Date('2026-07-14T07:00:00.000Z'))).toBe(false)
    expect(decision({
      mappedStatus: 'active',
      now: new Date('2026-11-14T16:00:00.000Z'),
      suppressOnly: true,
    })).toMatchObject({
      reason: 'calling_window_lock',
      touchLastActive: false,
      fillPhoneConnected: false,
      keepPriorStatus: true,
    })
  })
})

describe('line check lanes and price', () => {
  it('F5 reads the per-lookup price from the environment', () => {
    expect(lineCheckCostUsd({ LINE_CHECK_COST_USD: '0.02' } as NodeJS.ProcessEnv)).toBe(0.02)
    expect(() => lineCheckCostUsd({} as NodeJS.ProcessEnv)).toThrow(/LINE_CHECK_COST_USD is not configured/)
  })

  it('B4 orders fresh intake, then the loaded calling list, then backfill', () => {
    expect(lineCheckLane({
      lineCheckedAt: null,
      listPullDate: '2026-11-14',
      rowCreatedAt: null,
      rowStatus: 'ready',
      today: '2026-11-14',
    })).toBe('fresh_intake')
    expect(lineCheckLane({
      lineCheckedAt: NOW,
      listPullDate: '2026-11-01',
      rowCreatedAt: null,
      rowStatus: 'loaded_to_dialer',
      today: '2026-11-14',
    })).toBe('tier_1')
    expect(lineCheckLane({
      lineCheckedAt: null,
      listPullDate: '2026-10-01',
      rowCreatedAt: new Date('2026-10-01T12:00:00.000Z'),
      rowStatus: 'ready',
      today: '2026-11-14',
    })).toBe('backfill')
  })
})

describe('line check runner', () => {
  vi.stubEnv('LINE_CHECK_COST_USD', '0.02')

  function store(reserve: ReturnType<typeof vi.fn>, apply: ReturnType<typeof vi.fn>): PhoneLineCheckStore {
    return {
      syncConfig: vi.fn().mockResolvedValue(undefined),
      reserveCandidates: reserve,
      applyChecks: apply,
    }
  }

  it('B3 reserves budget before calling Twilio and does not look up a dropped row', async () => {
    const order: string[] = []
    const lookup = vi.fn(async () => {
      order.push('lookup')
      return {
        mappedStatus: 'inactive' as const,
        lineType: 'landline',
        twilioStatus: 'Inactive',
        twilioType: 'landline',
        failed: false,
        raw: { twilio_status: 'Inactive' },
      }
    })
    const reserve = vi.fn(async () => {
      order.push('reserve')
      return {
        remaining: 2,
        cap: null,
        candidates: [{ phoneE164: '+18165550100', prospectPhoneId: 'phone-1' }],
        skipped: [{ prospectPhoneId: 'phone-2', reason: 'dnc' }],
      }
    })
    const apply = vi.fn(async () => {
      order.push('apply')
      return { accepted: 1, stopped: false, cap: null, batchSize: 1, phonesToday: 1, costTodayUsd: 0.02, costMonthUsd: 0.02 }
    })
    const summary = await runPhoneLineChecks({
      store: store(reserve, apply),
      lookup,
      source: 'cron',
      actor: 'line-check-cron',
      now: () => new Date('2026-11-14T08:00:00.000Z').getTime(),
      deadlineMs: new Date('2026-11-14T08:00:00.000Z').getTime() + 1000,
    })
    expect(order).toEqual(['reserve', 'lookup', 'apply'])
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith('+18165550100')
    expect(summary).toMatchObject({ checked: 1, costUsd: 0.02, suppressOnly: false, skipped: [{ reason: 'dnc' }] })
  })

  it('does not call Twilio when the reserved batch is empty', async () => {
    const lookup = vi.fn()
    const apply = vi.fn().mockResolvedValue({
      accepted: 0, stopped: true, cap: 'daily_cost', batchSize: 0, phonesToday: 1000, costTodayUsd: 15, costMonthUsd: 15,
    })
    const summary = await runPhoneLineChecks({
      store: store(
        vi.fn().mockResolvedValue({ remaining: 0, cap: 'daily_cost', candidates: [], skipped: [] }),
        apply,
      ),
      lookup,
      source: 'cron',
      actor: 'line-check-cron',
      now: () => new Date('2026-11-14T08:00:00.000Z').getTime(),
      deadlineMs: new Date('2026-11-14T08:00:00.000Z').getTime() + 1000,
    })
    expect(lookup).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ checked: 0, stopped: true, cap: 'daily_cost' })
  })
})
