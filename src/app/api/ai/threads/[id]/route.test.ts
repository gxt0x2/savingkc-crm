import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), load: vi.fn(), archive: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/ai/generation-store', () => ({
  AssistantGenerationError: class AssistantGenerationError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message) }
  },
  loadAssistantThread: mocks.load,
  archiveAssistantThread: mocks.archive,
}))

import { GET, PATCH } from './route'

const context = { params: Promise.resolve({ id: 'thread-1' }) }

describe('assistant thread detail route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ subject: 'casey-user-id', email: 'casey@savingkc.com', name: 'Casey' })
    mocks.load.mockResolvedValue({ thread: { id: 'thread-1' }, messages: [] })
  })

  it('loads history through the verified actor scope', async () => {
    const request = new Request('https://crm.savingkc.com/api/ai/threads/thread-1')
    const response = await GET(request, context)
    expect(response.status).toBe(200)
    expect(mocks.actor).toHaveBeenCalledWith(request)
    expect(mocks.load).toHaveBeenCalledWith({ subject: 'casey-user-id' }, 'thread-1')
    expect(response.headers.get('vary')).toContain('Authorization')
  })

  it('rejects invalid mutations without touching the thread', async () => {
    const response = await PATCH(new Request('https://crm.savingkc.com/api/ai/threads/thread-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete' }),
    }), context)
    expect(response.status).toBe(400)
    expect(mocks.archive).not.toHaveBeenCalled()
  })

  it('archives instead of deleting history', async () => {
    const response = await PATCH(new Request('https://crm.savingkc.com/api/ai/threads/thread-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive' }),
    }), context)
    expect(response.status).toBe(200)
    expect(mocks.archive).toHaveBeenCalledWith({ subject: 'casey-user-id' }, 'thread-1')
  })

  it('does not use an email-only identity to read or archive private history', async () => {
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    const read = await GET(new Request('https://crm.savingkc.com/api/ai/threads/thread-1'), context)
    const archive = await PATCH(new Request('https://crm.savingkc.com/api/ai/threads/thread-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive' }),
    }), context)
    expect(read.status).toBe(401)
    expect(archive.status).toBe(401)
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.archive).not.toHaveBeenCalled()
  })
})
