import { describe, expect, it } from 'vitest'

import { centralMidnightUtc, summarizeDialerPerformance } from './dialer-daily-performance'

describe('dialer daily performance', () => {
  it('uses the correct Central offset in summer and winter', () => {
    expect(centralMidnightUtc('2026-08-25').toISOString()).toBe('2026-08-25T05:00:00.000Z')
    expect(centralMidnightUtc('2026-01-25').toISOString()).toBe('2026-01-25T06:00:00.000Z')
  })

  it('totals recent agent activity while excluding pauses', () => {
    const result = summarizeDialerPerformance({
      from: '2026-08-25',
      to: '2026-08-25',
      now: new Date('2026-08-25T14:25:00.000Z'),
      sessions: [{ id: 'session-1', started_at: '2026-08-25T14:00:00.000Z', ended_at: null, paused_at: null, last_interaction_at: '2026-08-25T14:24:00.000Z', idle_timeout_seconds: 300, status: 'active' }],
      events: [
        { session_id: 'session-1', event_type: 'session_started', created_at: '2026-08-25T14:00:00.000Z' },
        { session_id: 'session-1', event_type: 'session_activity', created_at: '2026-08-25T14:04:00.000Z' },
        { session_id: 'session-1', event_type: 'session_pause', created_at: '2026-08-25T14:10:00.000Z' },
        { session_id: 'session-1', event_type: 'session_resume', created_at: '2026-08-25T14:15:00.000Z' },
        { session_id: 'session-1', event_type: 'session_activity', created_at: '2026-08-25T14:19:00.000Z' },
        { session_id: 'session-1', event_type: 'session_activity', created_at: '2026-08-25T14:24:00.000Z' },
      ],
      attempts: [
        { session_id: 'session-1', created_at: '2026-08-25T14:05:00.000Z', started_at: '2026-08-25T14:05:00.000Z', connected_at: null, ended_at: '2026-08-25T14:05:30.000Z', dispositioned_at: '2026-08-25T14:06:00.000Z', reached: true },
        { session_id: 'session-1', created_at: '2026-08-25T14:20:00.000Z', started_at: '2026-08-25T14:20:00.000Z', connected_at: null, ended_at: '2026-08-25T14:20:30.000Z', dispositioned_at: '2026-08-25T14:21:00.000Z', reached: false },
        { session_id: 'session-1', created_at: '2026-08-25T14:22:00.000Z', started_at: null, connected_at: null, ended_at: null, dispositioned_at: null, reached: null },
      ],
      leads: [{ created_at: '2026-08-25T15:00:00.000Z' }],
    })

    expect(result.rows).toEqual([{
      metric_date: '2026-08-25',
      dialing_seconds: 1_200,
      calls: 2,
      contacts: 1,
      leads: 1,
    }])
  })

  it('splits a session across Central calendar days', () => {
    const result = summarizeDialerPerformance({
      from: '2026-08-24',
      to: '2026-08-25',
      now: new Date('2026-08-25T05:30:00.000Z'),
      sessions: [{ id: 'session-1', started_at: '2026-08-25T04:30:00.000Z', ended_at: '2026-08-25T05:30:00.000Z', paused_at: null, last_interaction_at: '2026-08-25T05:28:00.000Z', idle_timeout_seconds: 300, status: 'stopped' }],
      events: Array.from({ length: 15 }, (_, index) => ({
        session_id: 'session-1',
        event_type: 'session_activity',
        created_at: new Date(Date.parse('2026-08-25T04:30:00.000Z') + index * 4 * 60_000).toISOString(),
      })),
      attempts: [],
      leads: [],
    })

    expect(result.rows.map((row) => row.dialing_seconds)).toEqual([1_800, 1_800])
  })

  it('caps an unattended open tab at five minutes even when the session remains open', () => {
    const result = summarizeDialerPerformance({
      from: '2026-08-25',
      to: '2026-08-25',
      now: new Date('2026-08-25T16:00:00.000Z'),
      sessions: [{ id: 'session-1', started_at: '2026-08-25T14:00:00.000Z', ended_at: null, paused_at: null, last_interaction_at: '2026-08-25T14:00:00.000Z', idle_timeout_seconds: 300, status: 'active' }],
      events: [],
      attempts: [],
      leads: [],
    })

    expect(result.rows[0].dialing_seconds).toBe(300)
  })

  it('keeps a connected call active beyond the idle limit and starts a new deadline when it ends', () => {
    const result = summarizeDialerPerformance({
      from: '2026-08-25',
      to: '2026-08-25',
      now: new Date('2026-08-25T14:30:00.000Z'),
      sessions: [{ id: 'session-1', started_at: '2026-08-25T14:00:00.000Z', ended_at: null, paused_at: null, last_interaction_at: '2026-08-25T14:20:00.000Z', idle_timeout_seconds: 300, status: 'active' }],
      events: [],
      attempts: [{ session_id: 'session-1', created_at: '2026-08-25T14:01:00.000Z', started_at: '2026-08-25T14:02:00.000Z', connected_at: '2026-08-25T14:04:00.000Z', ended_at: '2026-08-25T14:20:00.000Z', dispositioned_at: null, reached: true }],
      leads: [],
    })

    expect(result.rows[0].dialing_seconds).toBe(1_500)
  })
})
