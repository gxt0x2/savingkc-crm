import { describe, expect, it } from 'vitest'
import { summarizeOperationalReconciliation } from './operational-reconciliation'

describe('summarizeOperationalReconciliation', () => {
  it('separates current, terminal, and unlinked overdue work without hiding demand', () => {
    const snapshot = summarizeOperationalReconciliation({
      now: new Date('2026-08-22T18:00:00.000Z'),
      workItemTotal: 5,
      threadTotal: 4,
      leads: [
        { id: 'lead-current', station: 'follow_up', classification: 'warm' },
        { id: 'lead-dead', station: 'dead', classification: 'dead' },
      ],
      workItems: [
        { work_item_key: 'one', lead_id: 'lead-current', status: 'pending', due_at: '2026-08-20T18:00:00.000Z', assigned_to: 'Casey', primary_next_action: true },
        { work_item_key: 'two', lead_id: 'lead-current', status: 'blocked', due_at: '2026-08-01T18:00:00.000Z', assigned_to: 'Casey', primary_next_action: true },
        { work_item_key: 'three', lead_id: 'lead-dead', status: 'pending', due_at: '2026-05-01T18:00:00.000Z', assigned_to: null, primary_next_action: true },
        { work_item_key: 'four', lead_id: null, status: 'pending', due_at: '2026-04-01T18:00:00.000Z', assigned_to: null, primary_next_action: false },
        { work_item_key: 'five', lead_id: 'lead-current', status: 'completed', due_at: '2026-04-01T18:00:00.000Z', assigned_to: 'Casey', primary_next_action: false },
      ],
      threads: [
        { thread_key: 'lead:current', lead_id: 'lead-current', last_channel: 'sms', last_activity_at: '2026-08-22T17:00:00.000Z', owner: 'Casey' },
        { thread_key: 'lead:dead', lead_id: 'lead-dead', last_channel: 'call', last_activity_at: '2026-05-01T18:00:00.000Z', owner: null },
        { thread_key: 'phone:one', lead_id: null, last_channel: 'sms', last_activity_at: '2026-08-01T18:00:00.000Z', owner: null },
        { thread_key: 'phone:two', lead_id: null, last_channel: 'voicemail', last_activity_at: '2025-08-01T18:00:00.000Z', owner: null },
      ],
    })

    expect(snapshot.degraded).toBe(false)
    expect(snapshot.workItems).toMatchObject({
      total: 5,
      active: 4,
      overdue: 4,
      overdueCurrent: 2,
      overdueTerminal: 1,
      overdueUnlinked: 1,
      leadsWithMultipleActive: 1,
      leadsWithMultiplePrimary: 1,
      maxActivePerLead: 2,
    })
    expect(snapshot.conversations).toMatchObject({
      needsReply: 4,
      known: 2,
      unmatched: 2,
      terminalKnown: 1,
      assigned: 1,
      unassigned: 3,
      channel: { call: 1, sms: 2, voicemail: 1 },
    })
  })

  it('flags capped classifications while preserving exact source totals', () => {
    const snapshot = summarizeOperationalReconciliation({
      now: new Date('2026-08-22T18:00:00.000Z'),
      workItems: [],
      workItemTotal: 6_000,
      threads: [],
      threadTotal: 6_500,
      leads: [],
    })

    expect(snapshot.degraded).toBe(true)
    expect(snapshot.workItems.total).toBe(6_000)
    expect(snapshot.conversations.needsReply).toBe(6_500)
    expect(snapshot.warning).toContain('5,000')
  })
})
