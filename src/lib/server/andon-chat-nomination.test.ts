import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: (payload: unknown) => {
        mocks.update(payload)
        return { eq: async () => ({ error: null }) }
      },
    }),
  }),
}))

import { isGoogleChatWebhookUrl, nominateAndonGoogleChatThread } from './andon-chat-nomination'

const WEBHOOK = 'https://chat.googleapis.com/v1/spaces/AAA/messages'
const example = {
  issueId: '00000000-0000-4000-8000-000000000001',
  issueKind: 'process',
  department: 'Acquisitions',
  category: 'Cold Dialer Lag',
  priority: 'medium',
  raisedBy: 'Casey',
  reporterEmail: 'casey@savingkc.com',
}

describe('Andon Google Chat nomination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        space: { name: 'spaces/AAA' },
        thread: { name: 'spaces/AAA/threads/BBB' },
      }),
    })
  })

  it('accepts only Google Chat incoming webhook hosts', () => {
    expect(isGoogleChatWebhookUrl(WEBHOOK)).toBe(true)
    expect(isGoogleChatWebhookUrl('https://evil.example/chat')).toBe(false)
  })

  it('logs and still succeeds when Chat credentials are missing', async () => {
    const result = await nominateAndonGoogleChatThread(example)

    expect(result).toEqual({
      attempted: false,
      posted: false,
      reason: 'chat_credentials_missing',
      chatSpaceId: null,
      chatThreadId: null,
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('stores CHAT_ANDON_SPACE so the Chat bot can poll list_open_andons', async () => {
    vi.stubEnv('CHAT_ANDON_SPACE', 'spaces/savingkc-andon')

    const result = await nominateAndonGoogleChatThread(example)

    expect(result.posted).toBe(false)
    expect(result.reason).toBe('chat_webhook_missing')
    expect(mocks.update).toHaveBeenCalledWith({ chat_space_id: 'spaces/savingkc-andon' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('posts into the configured space and stores the thread when a webhook exists', async () => {
    vi.stubEnv('CHAT_ANDON_SPACE', 'spaces/savingkc-andon')
    vi.stubEnv('CHAT_ANDON_WEBHOOK_URL', WEBHOOK)

    const result = await nominateAndonGoogleChatThread(example)

    expect(result).toMatchObject({
      attempted: true,
      posted: true,
      chatSpaceId: 'spaces/AAA',
      chatThreadId: 'spaces/AAA/threads/BBB',
    })
    expect(String(mocks.fetch.mock.calls[0]?.[0])).toContain('messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD')
    expect(mocks.fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: expect.stringContaining('Andon · Acquisitions · Cold Dialer Lag · 00000000'),
    })
    expect(mocks.update).toHaveBeenCalledWith({
      chat_space_id: 'spaces/AAA',
      chat_thread_id: 'spaces/AAA/threads/BBB',
    })
  })

  it('does not throw when Google Chat is down', async () => {
    vi.stubEnv('CHAT_ANDON_WEBHOOK_URL', WEBHOOK)
    mocks.fetch.mockRejectedValue(new Error('chat unavailable'))

    await expect(nominateAndonGoogleChatThread(example)).resolves.toMatchObject({
      attempted: true,
      posted: false,
      reason: 'chat_post_failed',
    })
  })
})
