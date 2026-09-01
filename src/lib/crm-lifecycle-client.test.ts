import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ operation: vi.fn() }))
vi.mock('@/lib/telephony/dialer-control-operation-client', () => ({
  withDialerSessionControlOperation: mocks.operation,
}))

import { transitionLeadLifecycle } from './crm-lifecycle-client'

describe('transitionLeadLifecycle', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('carries the durable session operation through a post-call dead transition', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    mocks.operation.mockImplementation(async (_sessionId, _label, work) => work({
      'X-Dialer-Controller': 'controller-token',
      'X-Dialer-Operation': 'operation-id',
    }, new AbortController().signal))

    await transitionLeadLifecycle('lead-1', {
      stage: 'dead',
      deadReason: 'wrong_number',
      dialerSessionId: 'session-1',
    })

    expect(mocks.operation).toHaveBeenCalledWith('session-1', 'Marking lead dead', expect.any(Function))
    expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1/lifecycle', {
      method: 'POST',
      signal: expect.any(AbortSignal),
      headers: {
        'Content-Type': 'application/json',
        'X-Dialer-Controller': 'controller-token',
        'X-Dialer-Operation': 'operation-id',
      },
      body: JSON.stringify({
        action: 'transition',
        stage: 'dead',
        deadReason: 'wrong_number',
        dialerSessionId: 'session-1',
      }),
    })
  })
})
