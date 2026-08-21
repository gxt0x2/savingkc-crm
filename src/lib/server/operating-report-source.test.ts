import { describe, expect, it } from 'vitest'

import {
  chunksOf,
  conversationStatesToThreads,
  takeBoundedRows,
  uniqueRowsById,
} from './operating-report-source'

describe('operating report source helpers', () => {
  it('caps response rows and reports when the source exceeded the contract', () => {
    expect(takeBoundedRows([1, 2, 3], 2)).toEqual({ rows: [1, 2], complete: false })
    expect(takeBoundedRows([1, 2], 2)).toEqual({ rows: [1, 2], complete: true })
  })

  it('batches large id lists without dropping or duplicating ids', () => {
    expect(chunksOf(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']])
    expect(() => chunksOf(['a'], 0)).toThrow('positive integer')
  })

  it('deduplicates overlapping period and deal-linked rows by id', () => {
    expect(uniqueRowsById(
      [{ id: 'one', value: 1 }, { id: 'two', value: 2 }],
      [{ id: 'two', value: 20 }, { id: 'three', value: 3 }],
    )).toEqual([
      { id: 'one', value: 1 },
      { id: 'two', value: 20 },
      { id: 'three', value: 3 },
    ])
  })

  it('uses the authoritative conversation projection for attention and next-action state', () => {
    expect(conversationStatesToThreads([
      {
        lead_id: 'lead-1',
        attention_state: 'needs_reply',
        owner: 'Casey',
        last_activity_at: '2026-08-20T12:00:00.000Z',
        primary_next_action_id: 'task-1',
        primary_next_action_due_at: '2026-08-20T13:00:00.000Z',
      },
      {
        lead_id: null,
        attention_state: 'needs_reply',
        owner: null,
        last_activity_at: null,
        primary_next_action_id: null,
        primary_next_action_due_at: null,
      },
    ], new Date('2026-08-21T00:00:00.000Z'))).toEqual([
      {
        id: 'lead-1',
        attentionState: 'needs_reply',
        owner: 'Casey',
        lastActivityAt: '2026-08-20T12:00:00.000Z',
        primaryNextAction: { overdue: true },
      },
    ])
  })
})
