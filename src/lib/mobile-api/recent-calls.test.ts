import { describe, expect, it } from 'vitest'

import { buildMobileRecentCalls, type RecentCallActivityRow } from './recent-calls'

function row(input: Partial<RecentCallActivityRow> & Pick<RecentCallActivityRow, 'id'>): RecentCallActivityRow {
  return {
    id: input.id,
    lead_id: input.lead_id ?? 'lead-1',
    activity_type: input.activity_type ?? 'call',
    description: input.description ?? null,
    metadata: input.metadata ?? {},
    created_at: input.created_at ?? '2026-09-18T18:00:00.000Z',
  }
}

describe('mobile recent calls', () => {
  it('keeps provider-only and blocked call attempts visible without inventing success', () => {
    const calls = buildMobileRecentCalls([
      row({
        id: 'blocked-1',
        metadata: {
          source: 'outbound_call_policy', client_attempt_id: 'attempt-1', direction: 'outbound',
          status: 'blocked', reason_code: 'policy_unavailable', phone: '+18165550123',
        },
      }),
      row({
        id: 'callback-1',
        created_at: '2026-09-18T17:00:00.000Z',
        metadata: {
          source: 'twilio_status_callback', clientAttemptId: 'attempt-2', direction: 'outbound',
          status: 'completed', to: '+18165550124', duration: 42,
        },
      }),
    ])

    expect(calls).toMatchObject([
      { id: 'blocked-1', phone: '+18165550123', outcome: 'failed' },
      { id: 'callback-1', phone: '+18165550124', outcome: 'answered', durationSeconds: 42 },
    ])
  })

  it('collapses provider and human rows for one attempt and prefers the saved disposition', () => {
    const calls = buildMobileRecentCalls([
      row({
        id: 'callback-1',
        metadata: {
          source: 'twilio_status_callback', clientAttemptId: 'attempt-1', direction: 'outbound',
          status: 'completed', to: '+18165550123', duration: 36,
        },
      }),
      row({
        id: 'outcome-1',
        created_at: '2026-09-18T18:01:00.000Z',
        description: 'Left a detailed voicemail.',
        metadata: {
          source: 'savingkc_mobile', clientCallId: 'attempt-1', direction: 'outbound',
          outcome: 'voicemail', phone: '+18165550123', duration: 0,
        },
      }),
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      id: 'outcome-1', outcome: 'voicemail', note: 'Left a detailed voicemail.', source: 'savingkc_mobile',
    })
  })

  it('maps a missed inbound as inbound so Recents is not treated as an outbound preview', () => {
    const calls = buildMobileRecentCalls([
      row({
        id: 'missed-1',
        activity_type: 'missed_call',
        metadata: { from: '+18165550999', direction: 'inbound', status: 'no-answer' },
      }),
    ])
    expect(calls[0]).toMatchObject({
      id: 'missed-1',
      direction: 'inbound',
      phone: '+18165550999',
      outcome: 'no_answer',
    })
  })

  it('keeps bad number and DNC outcomes distinct', () => {
    const calls = buildMobileRecentCalls([
      row({ id: 'bad', metadata: { outcome: 'bad_number', phone: '+18165550123' } }),
      row({ id: 'dnc', metadata: { outcome: 'dnc', phone: '+18165550124' } }),
    ])

    expect(calls.map((call) => call.outcome).sort()).toEqual(['bad_number', 'dnc'])
  })

  it('renders a client-side provider failure as not placed even when its fallback outcome is unknown', () => {
    const calls = buildMobileRecentCalls([
      row({ id: 'failed', metadata: { outcome: 'unknown', disposition: 'not_placed', phone: '+18165550123' } }),
    ])

    expect(calls[0].outcome).toBe('failed')
  })
})
