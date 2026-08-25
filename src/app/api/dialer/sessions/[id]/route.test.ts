import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedActor: vi.fn(),
  getDialerAttemptHistory: vi.fn(),
  getDialerSession: vi.fn(),
  transitionDialerSession: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.resolveAuthenticatedActor }))
vi.mock('@/lib/server/dialer-session-engine', () => ({
  DialerSessionError: class DialerSessionError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message) }
  },
  getDialerAttemptHistory: mocks.getDialerAttemptHistory,
  getDialerSession: mocks.getDialerSession,
  transitionDialerSession: mocks.transitionDialerSession,
}))

import { GET, PATCH } from './route'

const context = { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000010' }) }

describe('dialer session detail route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
  })

  it('rejects an unauthenticated attempt-history read before database work', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)

    const response = await GET(new Request('https://crm.savingkc.com/api/dialer/sessions/id?include=attempts'), context)

    expect(response.status).toBe(401)
    expect(mocks.getDialerAttemptHistory).not.toHaveBeenCalled()
  })

  it('loads bounded attempt history using only the verified actor', async () => {
    mocks.getDialerAttemptHistory.mockResolvedValue({
      session: { id: 'session-1' },
      attempts: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } },
    })

    const response = await GET(new Request('https://crm.savingkc.com/api/dialer/sessions/id?include=attempts&limit=25&cursor=opaque'), context)

    expect(response.status).toBe(200)
    expect(mocks.getDialerAttemptHistory).toHaveBeenCalledWith(
      { email: 'casey@savingkc.com', name: 'Casey' },
      '00000000-0000-4000-8000-000000000010',
      { limit: 25, cursor: 'opaque' },
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('persists a stop request for an active call using only the verified actor', async () => {
    mocks.transitionDialerSession.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000010',
      status: 'active',
      stopRequestedAt: '2026-08-25T20:00:00.000Z',
    })

    const response = await PATCH(new Request('https://crm.savingkc.com/api/dialer/sessions/id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request_stop', reason: 'Agent ended the session' }),
    }), context)

    expect(response.status).toBe(200)
    expect(mocks.transitionDialerSession).toHaveBeenCalledWith({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      sessionId: '00000000-0000-4000-8000-000000000010',
      action: 'request_stop',
      reason: 'Agent ended the session',
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('rejects an unauthenticated stop request before database work', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)

    const response = await PATCH(new Request('https://crm.savingkc.com/api/dialer/sessions/id', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'request_stop' }),
    }), context)

    expect(response.status).toBe(401)
    expect(mocks.transitionDialerSession).not.toHaveBeenCalled()
  })
})
