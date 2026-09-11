import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/ai/generation-store', () => ({
  AssistantGenerationError: class AssistantGenerationError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message) }
  },
  listAssistantThreads: mocks.list,
}))

import { GET } from './route'

describe('assistant thread list route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ subject: 'casey-user-id', email: 'casey@savingkc.com', name: 'Casey' })
    mocks.list.mockResolvedValue([{ id: 'thread-1', status: 'active' }])
  })

  it('rejects unauthenticated reads before querying history', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await GET(new Request('https://crm.savingkc.com/api/ai/threads'))
    expect(response.status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('lists only the verified actor threads with a bounded limit', async () => {
    const request = new Request('https://crm.savingkc.com/api/ai/threads?limit=500')
    const response = await GET(request)
    expect(response.status).toBe(200)
    expect(mocks.actor).toHaveBeenCalledWith(request)
    expect(mocks.list).toHaveBeenCalledWith({ subject: 'casey-user-id' }, 500)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('vary')).toContain('Authorization')
  })

  it('fails closed when a legacy identity has email but no immutable subject', async () => {
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    const response = await GET(new Request('https://crm.savingkc.com/api/ai/threads'))
    expect(response.status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
