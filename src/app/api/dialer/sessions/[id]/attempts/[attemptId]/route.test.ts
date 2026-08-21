import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedActor: vi.fn(),
  transitionDialerAttempt: vi.fn(),
  advanceDialerSessionAfterDisposition: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.resolveAuthenticatedActor }))
vi.mock('@/lib/server/dialer-session-engine', () => ({
  DialerSessionError: class DialerSessionError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message) }
  },
  transitionDialerAttempt: mocks.transitionDialerAttempt,
  advanceDialerSessionAfterDisposition: mocks.advanceDialerSessionAfterDisposition,
}))

import { PATCH } from './route'

const context = { params: Promise.resolve({ id: 'session-1', attemptId: 'attempt-1' }) }

function request(body: Record<string, unknown>) {
  return new Request('https://crm.savingkc.com/api/dialer/sessions/session-1/attempts/attempt-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('dialer session attempt transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
  })

  it('derives reached from the server disposition taxonomy', async () => {
    mocks.transitionDialerAttempt.mockResolvedValue({ status: 'dispositioned' })

    const response = await PATCH(request({ action: 'disposition', disposition: 'spoke_with_owner', reached: false }), context)

    expect(response.status).toBe(200)
    expect(mocks.transitionDialerAttempt).toHaveBeenCalledWith(expect.objectContaining({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      sessionId: 'session-1',
      clientAttemptId: 'attempt-1',
      disposition: 'spoke_with_owner',
      reached: true,
    }))
  })

  it('uses the disposition-gated advance operation', async () => {
    mocks.advanceDialerSessionAfterDisposition.mockResolvedValue({ id: 'session-1', currentIndex: 1 })

    const response = await PATCH(request({ action: 'advance' }), context)

    expect(response.status).toBe(200)
    expect(mocks.advanceDialerSessionAfterDisposition).toHaveBeenCalledWith({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      sessionId: 'session-1',
      clientAttemptId: 'attempt-1',
    })
    expect(mocks.transitionDialerAttempt).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated attempt mutation before parsing', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)
    const input = request({ action: 'started' })
    const parse = vi.spyOn(input, 'json')

    const response = await PATCH(input, context)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
  })
})
