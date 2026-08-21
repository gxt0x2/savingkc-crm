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
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.list.mockResolvedValue([{ id: 'thread-1', status: 'active' }])
  })

  it('rejects unauthenticated reads before querying history', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await GET(new Request('https://crm.savingkc.com/api/ai/threads'))
    expect(response.status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('lists only the verified actor threads with a bounded limit', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/ai/threads?limit=500'))
    expect(response.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith('casey@savingkc.com', 500)
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
})
