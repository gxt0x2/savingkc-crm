import { describe, expect, it } from 'vitest'

import { mergeTaskActivity, normalizeTaskActivityPatch } from './task-activity'

describe('task activity mutations', () => {
  it('records completion without discarding existing workflow metadata', () => {
    const update = mergeTaskActivity({
      description: 'Call seller',
      agent: 'Casey',
      metadata: { department: 'acquisitions', priority: 'high', status: 'pending' },
    }, { status: 'completed' }, '2026-08-10T18:00:00.000Z')

    expect(update.metadata).toMatchObject({
      department: 'acquisitions',
      priority: 'high',
      status: 'completed',
      completed_at: '2026-08-10T18:00:00.000Z',
    })
  })

  it('can reopen and reassign a task', () => {
    const update = mergeTaskActivity({
      description: 'Review offer',
      agent: 'Casey',
      metadata: { status: 'completed', completed_at: '2026-08-10T18:00:00.000Z' },
    }, { status: 'pending', assignedTo: 'Ernest' }, '2026-08-10T19:00:00.000Z')

    expect(update.agent).toBe('Ernest')
    expect(update.metadata).toMatchObject({ status: 'pending', assigned_to: 'Ernest', completed_at: null })
  })

  it('ignores unsupported values before they reach storage', () => {
    expect(normalizeTaskActivityPatch({ status: 'cancelled', assignedTo: 42, dueDate: 'not-a-date' })).toEqual({})
  })
})
