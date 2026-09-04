import { describe, expect, it, vi } from 'vitest'
import {
  andonChatThreadKey,
  andonChatTitle,
  andonCrmUrl,
  parseAndonNotes,
  presentAndon,
  updateAndonStatus,
} from './andon-write'

const EXAMPLE_ANDON_ID = '00000000-0000-4000-8000-000000000001'

describe('Andon assistant write helpers', () => {
  it('names the Chat war room from department, category, and short id', () => {
    expect(andonChatTitle('Acquisitions', 'Cold Dialer Lag', EXAMPLE_ANDON_ID))
      .toBe('Andon · Acquisitions · Cold Dialer Lag · 00000000')
    expect(andonChatThreadKey(EXAMPLE_ANDON_ID))
      .toBe('andon-00000000-0000-4000-8000-000000000001')
    expect(andonCrmUrl(EXAMPLE_ANDON_ID))
      .toBe('https://crm.savingkc.com/reports/andon?andon=00000000-0000-4000-8000-000000000001')
  })

  it('exposes a structured Chat nomination payload the bot can poll', () => {
    const presented = presentAndon({
      id: EXAMPLE_ANDON_ID,
      department: 'Acquisitions',
      category: 'Cold Dialer Lag',
      priority: 'medium',
      status: 'open',
      agent_name: 'Casey',
      notes: [{ body: 'Queue is stalled', author_email: 'ernest@savingkc.com', author_name: 'Ernest', created_at: '2026-08-31T12:00:00.000Z' }],
    })

    expect(presented.chatNomination).toMatchObject({
      title: 'Andon · Acquisitions · Cold Dialer Lag · 00000000',
      crmUrl: 'https://crm.savingkc.com/reports/andon?andon=00000000-0000-4000-8000-000000000001',
      threadKey: andonChatThreadKey(EXAMPLE_ANDON_ID),
      needsThread: true,
    })
    expect(presented.notes).toHaveLength(1)
  })

  it('drops empty note bodies', () => {
    expect(parseAndonNotes([{ body: '   ' }, { body: 'Need Casey on the line' }])).toEqual([
      expect.objectContaining({ body: 'Need Casey on the line' }),
    ])
  })

  it('updates Andon status on feedback_submissions only', async () => {
    const update = vi.fn().mockReturnValue({ eq: async () => ({ error: null }) })
    const from = vi.fn().mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: EXAMPLE_ANDON_ID,
              department: 'Acquisitions',
              category: 'Cold Dialer Lag',
              status: 'open',
            },
            error: null,
          }),
        }),
      }),
      update,
    })

    const result = await updateAndonStatus({ from }, EXAMPLE_ANDON_ID, 'acknowledged')

    expect(from).toHaveBeenCalledWith('feedback_submissions')
    expect(from).not.toHaveBeenCalledWith('leads')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'acknowledged' }))
    expect(result.andon.status).toBe('acknowledged')
  })
})
