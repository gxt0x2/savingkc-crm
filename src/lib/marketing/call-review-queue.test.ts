import { describe, expect, it } from 'vitest'

import { mergeCallActivityRows } from './call-review-queue'

describe('mergeCallActivityRows', () => {
  it('keeps a submitted review that falls outside the capped recent-call result', () => {
    const recentRows = [
      { id: 'recent-2', created_at: '2026-09-15T14:00:00.000Z' },
      { id: 'recent-1', created_at: '2026-09-15T13:00:00.000Z' },
    ]
    const reviewRows = [
      { id: 'missing-review', created_at: '2026-08-25T17:49:13.000Z' },
      { id: 'recent-1', created_at: '2026-09-15T13:00:00.000Z' },
    ]

    expect(mergeCallActivityRows(recentRows, reviewRows).map((row) => row.id)).toEqual([
      'recent-2',
      'recent-1',
      'missing-review',
    ])
  })
})
