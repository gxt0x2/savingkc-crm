import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), readAttention: vi.fn() }))

vi.mock('@/lib/api/require-authenticated-user', () => ({
  requireAuthenticatedUser: mocks.auth,
}))
vi.mock('@/lib/server/conversation-read-model', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/conversation-read-model')>(
    '@/lib/server/conversation-read-model',
  )
  return { ...actual, readConversationAttention: mocks.readAttention }
})

import { ConversationReadModelUnavailableError } from '@/lib/server/conversation-read-model'
import { GET } from './route'

describe('conversation attention API', () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue(null)
    mocks.readAttention.mockReset()
  })

  it('returns canonical projection counts', async () => {
    mocks.readAttention.mockResolvedValue({
      needsReply: 4,
      calls: 1,
      emails: 1,
      texts: 2,
      overdue: 3,
      source: 'projection',
      degraded: false,
    })

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ needsReply: 4, source: 'projection', degraded: false })
    expect(response.headers.get('server-timing')).toMatch(/^total;dur=/)
  })

  it('returns 503 rather than a false partial count before migration', async () => {
    mocks.readAttention.mockRejectedValue(new ConversationReadModelUnavailableError())

    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: 'CONVERSATION_READ_MODEL_UNAVAILABLE',
      retryable: true,
    })
  })

  it('does not expose canonical counts without a route-local session', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))

    const response = await GET()

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.readAttention).not.toHaveBeenCalled()
  })
})
