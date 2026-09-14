import { describe, expect, it } from 'vitest'
import {
  primaryView,
  matchesView,
  type PilotThread,
  type InboxView,
} from '../workflow/types'
import { practiceReply } from '../workflow/presentation'

describe('focused work queues', () => {
  const asOf = '2026-09-14T15:00:00Z'
  const thread = (fields: Partial<PilotThread>) =>
    ({ state: 'waiting', has_outbound: true, ...fields }) as PilotThread
  it('puts each conversation in exactly one primary queue and All', () => {
    const samples: [Partial<PilotThread>, InboxView][] = [
      [{}, 'waiting'],
      [{ has_outbound: false }, 'scheduled'],
      [{ state: 'human' }, 'action'],
      [{ state: 'done' }, 'done'],
      [
        {
          callback_task_state: 'pending',
          callback_due_at: '2026-09-14T15:30:00Z',
        },
        'action',
      ],
      [
        {
          callback_task_state: 'pending',
          scheduled_for: '2026-09-15T15:00:00Z',
        },
        'scheduled',
      ],
      [
        {
          callback_task_state: 'pending',
          scheduled_for: '2026-09-14T14:00:00Z',
        },
        'action',
      ],
      [
        { state: 'needs_review', scheduled_for: '2026-09-15T15:00:00Z' },
        'action',
      ],
      [{ state: 'stopped', handoff_state: 'held' }, 'action'],
      [{ state: 'stopped', callback_request: { messageId: 'test', phone: '816-555-0101', testOnly: true, reviewed: false } }, 'action'],
      [{ state: 'stopped', callback_request: { messageId: 'test', phone: '816-555-0101', testOnly: true, reviewed: true } }, 'done'],
      [
        {
          state: 'stopped',
          handoff_state: 'completed',
          callback_task_state: 'completed',
        },
        'done',
      ],
    ]
    for (const [fields, expected] of samples) {
      const t = thread(fields)
      expect(primaryView(t, asOf)).toBe(expected)
      expect(
        (['action', 'scheduled', 'waiting', 'done'] as InboxView[]).filter(
          (v) => matchesView(t, v, asOf),
        ),
      ).toEqual([expected])
      expect(matchesView(t, 'all', asOf)).toBe(true)
    }
  })
  it('prepares direct phone replies while excluding signatures, quotes and third parties', () => {
    expect(practiceReply('816-555-0101').phone).toBe('816-555-0101')
    expect(
      practiceReply(
        'I might consider selling. Call me at 816-555-0101. Tomorrow afternoon works.',
      ),
    ).toMatchObject({
      phone: '816-555-0101',
      time: 'Tomorrow afternoon',
      interest: true,
    })
    expect(
      practiceReply('Thanks\n--\nCall me at 816-555-0101').phone,
    ).toBeUndefined()
    expect(
      practiceReply('Thanks\nOn Monday Jamie wrote:\nCall me at 816-555-0101')
        .phone,
    ).toBeUndefined()
    expect(
      practiceReply('Call my sister at 816-555-0101').phone,
    ).toBeUndefined()
    expect(
      practiceReply('Please unsubscribe me. Call me at 816-555-0101').body,
    ).toBe('')
    expect(practiceReply('I have a question about taxes.').body).toBe('')
  })
})
