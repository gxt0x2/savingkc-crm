import { describe, expect, it } from 'vitest'
import {
  CALLING_DAY_TIMEZONE,
  STALE_PAUSED_SESSION_SLA_MS,
  callingDayStartUtc,
  isStalePausedDialerSession,
  stalePausedHardStopMessage,
  stalePausedReasons,
} from './dialer-stale-paused-session'

describe('stale paused dialer session', () => {
  it('treats a paused session with zero Chicago-day attempts as a hard stop', () => {
    expect(stalePausedReasons({
      status: 'paused',
      endedAt: null,
      pausedAt: '2026-09-01T16:55:40.491Z',
      attemptCountToday: 0,
      now: new Date('2026-09-01T20:14:00.000Z'),
    })).toEqual(['zero_attempts_today', 'paused_past_sla'])
    expect(isStalePausedDialerSession({
      status: 'paused',
      endedAt: null,
      pausedAt: '2026-09-01T16:55:40.491Z',
      attemptCountToday: 0,
      now: new Date('2026-09-01T20:14:00.000Z'),
    })).toBe(true)
  })

  it('treats a recent pause as stale only when the calling day still has zero attempts', () => {
    expect(stalePausedReasons({
      status: 'paused',
      endedAt: null,
      pausedAt: '2026-09-01T20:10:00.000Z',
      attemptCountToday: 0,
      now: new Date('2026-09-01T20:14:00.000Z'),
    })).toEqual(['zero_attempts_today'])
  })

  it('keeps a just-paused working session off the hard stop when it already has today attempts', () => {
    expect(isStalePausedDialerSession({
      status: 'paused',
      endedAt: null,
      pausedAt: '2026-09-01T20:10:00.000Z',
      attemptCountToday: 4,
      now: new Date('2026-09-01T20:14:00.000Z'),
    })).toBe(false)
  })

  it('flags a pause that outlives the short SLA even after today attempts', () => {
    expect(stalePausedReasons({
      status: 'paused',
      endedAt: null,
      pausedAt: '2026-09-01T16:55:40.491Z',
      attemptCountToday: 3,
      now: new Date('2026-09-01T20:14:00.000Z'),
      slaMs: STALE_PAUSED_SESSION_SLA_MS,
    })).toEqual(['paused_past_sla'])
  })

  it('never treats ended, stopped, or active sessions as stale paused', () => {
    expect(isStalePausedDialerSession({
      status: 'paused',
      endedAt: '2026-09-01T17:00:00.000Z',
      pausedAt: '2026-09-01T16:55:40.491Z',
      attemptCountToday: 0,
      now: new Date('2026-09-01T20:14:00.000Z'),
    })).toBe(false)
    expect(isStalePausedDialerSession({
      status: 'active',
      endedAt: null,
      pausedAt: null,
      attemptCountToday: 0,
      now: new Date('2026-09-01T20:14:00.000Z'),
    })).toBe(false)
  })

  it('starts the Chicago calling day at local midnight across CST and CDT', () => {
    expect(callingDayStartUtc(new Date('2026-09-01T16:55:40.491Z')).toISOString()).toBe('2026-09-01T05:00:00.000Z')
    expect(callingDayStartUtc(new Date('2026-01-15T18:00:00.000Z')).toISOString()).toBe('2026-01-15T06:00:00.000Z')
    expect(CALLING_DAY_TIMEZONE).toBe('America/Chicago')
  })

  it('names the wedged campaign so acquisitions can clear instead of resume', () => {
    expect(stalePausedHardStopMessage({
      campaignName: 'Jackson · Tax 3+ · 7 zips · Aug 30',
      sessionId: '11355a3b-e5fa-4ecf-8cff-7720fa2428cb',
      reasons: ['zero_attempts_today'],
      attemptCountToday: 0,
    })).toContain('0 attempts today')
    expect(stalePausedHardStopMessage({
      campaignName: 'Jackson · Tax 3+ · 7 zips · Aug 30',
      sessionId: '11355a3b-e5fa-4ecf-8cff-7720fa2428cb',
      reasons: ['paused_past_sla'],
      attemptCountToday: 3,
    })).toContain('15-minute SLA')
  })
})
