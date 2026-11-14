import { describe, expect, it, vi } from 'vitest'
import {
  PHONE_LINE_CHECK_COST_USD,
  decidePhoneLineCheck,
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

  it('reads the Lookup v2 field names and prices both packages at $0.015', () => {
    expect(PHONE_LINE_CHECK_COST_USD).toBe(0.015)
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

describe('counsel line-check decisions', () => {
  it('soft-suppresses a first inactive result and does not treat it as a recheck', () => {
    expect(decidePhoneLineCheck({
      mappedStatus: 'inactive',
      failed: false,
      priorStatus: null,
      priorCheckedAt: null,
      recheckCount: 0,
      dialDisconnected: false,
      rnd: 'unavailable',
      now: NOW,
    })).toMatchObject({
      lineStatus: 'suppressed_lookup_inactive',
      reason: 'lookup_inactive',
      recheckCount: 0,
      fillPhoneConnected: false,
    })
  })

  it('keeps the soft suppress at the 30-day recheck and permanent-suppresses the 60-day recheck', () => {
    expect(decidePhoneLineCheck({
      mappedStatus: 'inactive',
      failed: false,
      priorStatus: 'suppressed_lookup_inactive',
      priorCheckedAt: new Date(NOW.getTime() - 30 * DAY),
      recheckCount: 0,
      dialDisconnected: false,
      rnd: 'unavailable',
      now: NOW,
    })).toMatchObject({ lineStatus: 'suppressed_lookup_inactive', reason: 'lookup_inactive', recheckCount: 1 })
    expect(decidePhoneLineCheck({
      mappedStatus: 'inactive',
      failed: false,
      priorStatus: 'suppressed_lookup_inactive',
      priorCheckedAt: new Date(NOW.getTime() - 30 * DAY),
      recheckCount: 1,
      dialDisconnected: false,
      rnd: 'unavailable',
      now: NOW,
    })).toMatchObject({ lineStatus: 'suppressed_bad_number', reason: 'recheck_still_inactive', recheckCount: 2 })
  })

  it('does not restore a recheck that comes back active while RND is unavailable', () => {
    expect(decidePhoneLineCheck({
      mappedStatus: 'active',
      failed: false,
      priorStatus: 'suppressed_lookup_inactive',
      priorCheckedAt: new Date(NOW.getTime() - 30 * DAY),
      recheckCount: 0,
      dialDisconnected: false,
      rnd: 'unavailable',
      now: NOW,
    })).toMatchObject({
      lineStatus: 'suppressed_bad_number',
      reason: 'recheck_active_rnd_unavailable',
      fillPhoneConnected: false,
      rnd: 'unavailable',
    })
  })

  it('leaves the RND clear path ready without using it today', () => {
    expect(decidePhoneLineCheck({
      mappedStatus: 'active',
      failed: false,
      priorStatus: 'suppressed_lookup_inactive',
      priorCheckedAt: new Date(NOW.getTime() - 30 * DAY),
      recheckCount: 1,
      dialDisconnected: false,
      rnd: 'clear',
      now: NOW,
    })).toMatchObject({ lineStatus: 'active', reason: 'recheck_active_rnd_clear', fillPhoneConnected: true, rnd: 'clear' })
    expect(decidePhoneLineCheck({
      mappedStatus: 'active',
      failed: false,
      priorStatus: 'suppressed_lookup_inactive',
      priorCheckedAt: new Date(NOW.getTime() - 30 * DAY),
      recheckCount: 1,
      dialDisconnected: false,
      rnd: 'permanent_disconnect',
      now: NOW,
    })).toMatchObject({ lineStatus: 'suppressed_bad_number', reason: 'rnd_permanent_disconnect' })
  })

  it('holds an unreachable line without counting it as an inactive recheck', () => {
    expect(decidePhoneLineCheck({
      mappedStatus: 'unreachable',
      failed: false,
      priorStatus: 'active',
      priorCheckedAt: new Date(NOW.getTime() - 30 * DAY),
      recheckCount: 0,
      dialDisconnected: false,
      rnd: 'unavailable',
      now: NOW,
    })).toMatchObject({ lineStatus: 'unreachable', reason: 'unreachable_hold', recheckCount: 0 })
  })

  it('keeps a dial disconnect permanent', () => {
    expect(decidePhoneLineCheck({
      mappedStatus: 'active',
      failed: false,
      priorStatus: 'active',
      priorCheckedAt: new Date(NOW.getTime() - DAY),
      recheckCount: 0,
      dialDisconnected: true,
      rnd: 'clear',
      now: NOW,
    })).toMatchObject({ lineStatus: 'suppressed_bad_number', reason: 'dial_disconnect', fillPhoneConnected: false })
  })

  it('flags a failed check when the phone was active within 90 days and fails closed after that', () => {
    expect(decidePhoneLineCheck({
      mappedStatus: 'unknown',
      failed: true,
      priorStatus: 'active',
      priorCheckedAt: new Date(NOW.getTime() - 89 * DAY),
      recheckCount: 0,
      dialDisconnected: false,
      rnd: 'unavailable',
      now: NOW,
    })).toMatchObject({ lineStatus: 'active', reason: 'check_failed_stale_active', staleActiveExport: true })
    expect(decidePhoneLineCheck({
      mappedStatus: 'unknown',
      failed: true,
      priorStatus: 'active',
      priorCheckedAt: new Date(NOW.getTime() - 91 * DAY),
      recheckCount: 0,
      dialDisconnected: false,
      rnd: 'unavailable',
      now: NOW,
    })).toMatchObject({ lineStatus: 'unknown', reason: 'check_failed', staleActiveExport: false })
  })

  it('fills phone_connected only for a real active result', () => {
    expect(decidePhoneLineCheck({
      mappedStatus: 'active',
      failed: false,
      priorStatus: null,
      priorCheckedAt: null,
      recheckCount: 0,
      dialDisconnected: false,
      rnd: 'unavailable',
      now: NOW,
    })).toMatchObject({ lineStatus: 'active', reason: 'lookup_active', fillPhoneConnected: true })
  })
})

describe('line check runner', () => {
  it('looks up due phones with a mock and stops when the cap is already hit', async () => {
    const lookup = vi.fn()
    const applyChecks = vi.fn().mockResolvedValue({
      accepted: 0, stopped: true, cap: 'daily_cost', batchSize: 0, phonesToday: 1000, costTodayUsd: 15, costMonthUsd: 15,
    })
    const store: PhoneLineCheckStore = {
      selectCandidates: vi.fn().mockResolvedValue({ remaining: 0, cap: 'daily_cost', candidates: [], skipped: [] }),
      applyChecks,
    }
    const summary = await runPhoneLineChecks({
      store,
      lookup,
      source: 'cron',
      actor: 'line-check-cron',
      now: () => NOW.getTime(),
      deadlineMs: NOW.getTime() + 1000,
    })
    expect(lookup).not.toHaveBeenCalled()
    expect(applyChecks).toHaveBeenCalledWith(expect.objectContaining({ reportCap: true, results: [], source: 'cron' }))
    expect(summary).toMatchObject({ checked: 0, stopped: true, cap: 'daily_cost', costUsd: 0 })
  })

  it('records a failed mock lookup without calling a live provider', async () => {
    const lookup = vi.fn().mockResolvedValue({
      mappedStatus: 'active',
      lineType: 'mobile',
      twilioStatus: 'Active',
      twilioType: 'mobile',
      failed: false,
      raw: { twilio_status: 'Active', twilio_type: 'mobile' },
    })
    const store: PhoneLineCheckStore = {
      selectCandidates: vi.fn()
        .mockResolvedValueOnce({
          remaining: 10,
          cap: null,
          candidates: [{ phoneE164: '+18165550100', prospectPhoneId: 'phone-1' }],
          skipped: [{ prospectPhoneId: 'phone-2', reason: 'dnc' }],
        })
        .mockResolvedValueOnce({ remaining: 9, cap: null, candidates: [], skipped: [] }),
      applyChecks: vi.fn().mockResolvedValue({
        accepted: 1, stopped: false, cap: null, batchSize: 1, phonesToday: 1, costTodayUsd: 0.015, costMonthUsd: 0.015,
      }),
    }
    const summary = await runPhoneLineChecks({
      store,
      lookup,
      source: 'manual',
      actor: 'casey@savingkc.com',
      prospectPhoneIds: ['phone-1', 'phone-2'],
      now: () => NOW.getTime(),
      deadlineMs: NOW.getTime() + 1000,
    })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith('+18165550100')
    expect(summary).toMatchObject({
      checked: 1,
      failed: 0,
      costUsd: 0.015,
      skipped: [{ prospectPhoneId: 'phone-2', reason: 'dnc' }],
    })
    expect(JSON.stringify(summary)).not.toContain('CRON_SECRET')
  })
})
