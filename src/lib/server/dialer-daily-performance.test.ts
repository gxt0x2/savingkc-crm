import { describe, expect, it } from 'vitest'

import { centralMidnightUtc, summarizeDialerPerformance } from './dialer-daily-performance'

describe('dialer daily performance', () => {
  it('uses the correct Central offset in summer and winter', () => {
    expect(centralMidnightUtc('2026-08-25').toISOString()).toBe('2026-08-25T05:00:00.000Z')
    expect(centralMidnightUtc('2026-01-25').toISOString()).toBe('2026-01-25T06:00:00.000Z')
  })

  it('totals active session time while excluding pauses and requested dials', () => {
    const result = summarizeDialerPerformance({
      from: '2026-08-25',
      to: '2026-08-25',
      now: new Date('2026-08-25T16:00:00.000Z'),
      sessions: [{ id: 'session-1', started_at: '2026-08-25T14:00:00.000Z', ended_at: null, paused_at: null, status: 'active' }],
      events: [
        { session_id: 'session-1', event_type: 'session_started', created_at: '2026-08-25T14:00:00.000Z' },
        { session_id: 'session-1', event_type: 'session_pause', created_at: '2026-08-25T14:30:00.000Z' },
        { session_id: 'session-1', event_type: 'session_resume', created_at: '2026-08-25T14:45:00.000Z' },
      ],
      attempts: [
        { started_at: '2026-08-25T14:05:00.000Z', reached: true },
        { started_at: '2026-08-25T14:20:00.000Z', reached: false },
        { started_at: null, reached: null },
      ],
      leads: [{ created_at: '2026-08-25T15:00:00.000Z' }],
    })

    expect(result.rows).toEqual([{
      metric_date: '2026-08-25',
      dialing_seconds: 6_300,
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
      sessions: [{ id: 'session-1', started_at: '2026-08-25T04:30:00.000Z', ended_at: '2026-08-25T05:30:00.000Z', paused_at: null, status: 'stopped' }],
      events: [],
      attempts: [],
      leads: [],
    })

    expect(result.rows.map((row) => row.dialing_seconds)).toEqual([1_800, 1_800])
  })
})
