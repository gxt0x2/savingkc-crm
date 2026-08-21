import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

let buildDialerQueueContext: typeof import('./dialer-queue-context').buildDialerQueueContext

beforeAll(async () => {
  ;({ buildDialerQueueContext } = await import('./dialer-queue-context'))
})

describe('dialer queue context', () => {
  it('compresses calls and follow-ups into one row per requested lead', () => {
    const result = buildDialerQueueContext(
      ['lead-1', 'lead-2'],
      [
        { lead_id: 'lead-1', metadata: { due_date: '2026-08-21T16:00:00Z', status: 'pending' } },
        { lead_id: 'lead-2', metadata: { due_date: '2026-08-20T16:00:00Z', status: 'completed' } },
        { lead_id: 'outside', metadata: { due_date: '2026-08-21T16:00:00Z', status: 'pending' } },
      ],
      [
        { lead_id: 'lead-1', activity_type: 'sms', created_at: '2026-08-21T14:00:00Z' },
        { lead_id: 'lead-1', activity_type: 'call', created_at: '2026-08-21T15:00:00Z' },
        { lead_id: 'lead-1', activity_type: 'voicemail', created_at: '2026-08-20T15:00:00Z' },
        { lead_id: 'lead-2', activity_type: 'call', created_at: '2026-08-21T17:00:00Z' },
        { lead_id: 'outside', activity_type: 'call', created_at: '2026-08-21T18:00:00Z' },
      ],
      new Date('2026-08-21T18:00:00Z'),
    )

    expect(result.context).toEqual([
      {
        leadId: 'lead-1',
        lastContactAt: '2026-08-21T15:00:00Z',
        lastDialedAt: '2026-08-21T15:00:00Z',
        callAttemptCount: 2,
        hasDueFollowup: true,
        scheduledToday: true,
      },
      {
        leadId: 'lead-2',
        lastContactAt: '2026-08-21T17:00:00Z',
        lastDialedAt: '2026-08-21T17:00:00Z',
        callAttemptCount: 1,
        hasDueFollowup: false,
        scheduledToday: false,
      },
    ])
    expect(result.metrics).toEqual({ callsToday: 2, uniqueLeadsToday: 2 })
  })

  it('uses the SavingKC timezone across the UTC date boundary', () => {
    const result = buildDialerQueueContext(
      ['lead-1'],
      [{ lead_id: 'lead-1', metadata: { due_date: '2026-08-22T01:00:00Z', status: 'pending' } }],
      [{ lead_id: 'lead-1', activity_type: 'call', created_at: '2026-08-22T01:00:00Z' }],
      new Date('2026-08-21T23:00:00Z'),
    )

    expect(result.context[0].scheduledToday).toBe(true)
    expect(result.metrics.callsToday).toBe(1)
  })
})
