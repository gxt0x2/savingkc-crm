import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), readTimeline: vi.fn() }))

vi.mock('@/lib/api/require-authenticated-user', () => ({
  requireAuthenticatedUser: mocks.auth,
}))
vi.mock('@/lib/server/conversation-read-model', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/conversation-read-model')>(
    '@/lib/server/conversation-read-model',
  )
  return { ...actual, readConversationTimeline: mocks.readTimeline }
})

import { GET } from './route'

describe('conversation timeline API', () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue(null)
    mocks.readTimeline.mockReset()
  })

  it('passes an opaque cursor into a bounded timeline read', async () => {
    mocks.readTimeline.mockResolvedValue({
      threadId: 'lead-id',
      threadKey: 'lead:lead-id',
      items: [],
      pageInfo: { limit: 25, hasMore: false, nextCursor: null },
      source: 'projection',
      degraded: false,
    })
    const response = await GET(new Request(
      'https://crm.savingkc.com/api/conversations/timeline?threadId=lead-id&limit=25&cursor=opaque',
    ))

    expect(response.status).toBe(200)
    expect(mocks.readTimeline).toHaveBeenCalledWith({ threadId: 'lead-id', limit: 25, cursor: 'opaque' })
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('server-timing')).toMatch(/^total;dur=/)
  })

  it('requires a thread id', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/conversations/timeline'))

    expect(response.status).toBe(400)
    expect(mocks.readTimeline).not.toHaveBeenCalled()
  })

  it('does not call the service-role read when the session is missing', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))

    const response = await GET(new Request(
      'https://crm.savingkc.com/api/conversations/timeline?threadId=00000000-0000-4000-8000-000000000001',
    ))

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.readTimeline).not.toHaveBeenCalled()
  })
})
