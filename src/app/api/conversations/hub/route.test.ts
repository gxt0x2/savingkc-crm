import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  actor: vi.fn(),
  readThreads: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({
  resolveAuthenticatedActor: mocks.actor,
}))
vi.mock('@/lib/api/require-authenticated-user', () => ({
  requireAuthenticatedUser: mocks.auth,
}))

vi.mock('@/lib/server/conversation-read-model', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/conversation-read-model')>(
    '@/lib/server/conversation-read-model',
  )
  return { ...actual, readConversationThreads: mocks.readThreads }
})

import { GET } from './route'
import { ConversationReadModelUnavailableError } from '@/lib/server/conversation-read-model'

const emptyPage = {
  items: [],
  unmatchedActivities: [],
  pageInfo: { limit: 50, hasMore: false, nextCursor: null },
  source: 'projection' as const,
  degraded: false,
}

describe('conversation hub API', () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue(null)
    mocks.actor.mockReset()
    mocks.readThreads.mockReset().mockResolvedValue(emptyPage)
  })

  it('defaults to the bounded needs-reply queue', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/conversations/hub'))

    expect(response.status).toBe(200)
    expect(mocks.readThreads).toHaveBeenCalledWith({
      limit: 50,
      queue: 'needs_reply',
      channel: null,
      query: null,
      kind: 'all',
      actorName: null,
      cursor: null,
    })
    expect(mocks.actor).not.toHaveBeenCalled()
    expect(response.headers.get('x-conversation-read-model')).toBe('projection')
    expect(response.headers.get('server-timing')).toMatch(/^total;dur=/)
    expect(response.headers.get('x-conversation-row-count')).toBe('0')
  })

  it('resolves Mine from the authenticated actor instead of a client owner name', async () => {
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey Davis' })

    const response = await GET(new Request(
      'https://crm.savingkc.com/api/conversations/hub?queue=mine&owner=Ernest&q=smith&channel=sms&limit=25',
    ))

    expect(response.status).toBe(200)
    expect(mocks.readThreads).toHaveBeenCalledWith(expect.objectContaining({
      queue: 'mine',
      actorName: 'Casey Davis',
      query: 'smith',
      channel: 'sms',
      limit: 25,
    }))
    expect(mocks.readThreads.mock.calls[0]?.[0]).not.toHaveProperty('owner')
  })

  it('fails the Mine queue closed when no authenticated actor exists', async () => {
    mocks.actor.mockResolvedValue(null)

    const response = await GET(new Request('https://crm.savingkc.com/api/conversations/hub?queue=mine'))

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.readThreads).not.toHaveBeenCalled()
  })

  it('exits before the read model when the route-local session is missing', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))

    const response = await GET(new Request('https://crm.savingkc.com/api/conversations/hub?queue=all'))

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.actor).not.toHaveBeenCalled()
    expect(mocks.readThreads).not.toHaveBeenCalled()
  })

  it('rejects invalid or unindexed short searches', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/conversations/hub?q=ab'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'q must contain at least 3 characters' })
  })

  it('passes the indexed known-contact filter to the read model', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/conversations/hub?kind=known'))
    expect(response.status).toBe(200)
    expect(mocks.readThreads).toHaveBeenCalledWith(expect.objectContaining({ kind: 'known' }))
  })

  it('returns explicit 503 when migration-first rollout has not completed', async () => {
    mocks.readThreads.mockRejectedValue(new ConversationReadModelUnavailableError())

    const response = await GET(new Request('https://crm.savingkc.com/api/conversations/hub'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: 'CONVERSATION_READ_MODEL_UNAVAILABLE',
      retryable: true,
    })
  })
})
