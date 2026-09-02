import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedActor: vi.fn(),
  claimDialerSessionControl: vi.fn(),
  heartbeatDialerSessionControl: vi.fn(),
  disconnectProviderCallForTakeover: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.resolveAuthenticatedActor }))
vi.mock('@/lib/server/dialer-session-engine', () => ({
  DialerSessionError: class DialerSessionError extends Error {
    constructor(
      public code: string,
      public status: number,
      message: string,
      public details?: Record<string, unknown>,
    ) { super(message) }
  },
  claimDialerSessionControl: mocks.claimDialerSessionControl,
  heartbeatDialerSessionControl: mocks.heartbeatDialerSessionControl,
}))
vi.mock('@/lib/server/dialer-provider-call-control', () => ({
  disconnectProviderCallForTakeover: mocks.disconnectProviderCallForTakeover,
}))

import { PATCH, POST } from './route'

const sessionId = '00000000-0000-4000-8000-000000000010'
const controllerToken = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actor = { email: 'casey@savingkc.com', name: 'Casey' }
const context = { params: Promise.resolve({ id: sessionId }) }

function controlRequest(method: 'PATCH' | 'POST', body?: Record<string, unknown>, withController = true) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/126.0.0.0 Chrome/126.0.0.0',
  }
  if (withController) headers['X-Dialer-Controller'] = controllerToken
  return new Request(`https://crm.savingkc.com/api/dialer/sessions/${sessionId}/control`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('dialer session controller lease route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue(actor)
    mocks.disconnectProviderCallForTakeover.mockResolvedValue('not_required')
  })

  it('renews only the authenticated browser controller heartbeat', async () => {
    mocks.heartbeatDialerSessionControl.mockResolvedValue({
      session: { id: sessionId, status: 'active' },
      control: { generation: 2 },
    })

    const response = await PATCH(controlRequest('PATCH'), context)

    expect(response.status).toBe(200)
    expect(mocks.heartbeatDialerSessionControl).toHaveBeenCalledWith({
      actor,
      sessionId,
      controllerToken,
      userActive: false,
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('distinguishes real agent activity from a passive controller heartbeat', async () => {
    mocks.heartbeatDialerSessionControl.mockResolvedValue({
      session: { id: sessionId, status: 'active' },
      control: { generation: 2 },
    })

    const response = await PATCH(controlRequest('PATCH', { userActive: true }), context)

    expect(response.status).toBe(200)
    expect(mocks.heartbeatDialerSessionControl).toHaveBeenCalledWith({
      actor,
      sessionId,
      controllerToken,
      userActive: true,
    })
  })

  it('atomically transfers control with the observed generation and request id', async () => {
    mocks.claimDialerSessionControl.mockResolvedValue({
      session: { id: sessionId, status: 'active' },
      control: { generation: 3 },
      transferred: true,
      interruptedAttempt: {
        clientAttemptId: 'attempt-1',
        status: 'connected',
        providerCallSid: `CA${'1'.repeat(32)}`,
      },
    })
    mocks.disconnectProviderCallForTakeover.mockResolvedValue('disconnected')

    const response = await POST(controlRequest('POST', {
      action: 'takeover',
      expectedGeneration: 2,
      requestId: 'takeover-casey-1',
    }), context)

    expect(response.status).toBe(200)
    expect(mocks.claimDialerSessionControl).toHaveBeenCalledWith({
      actor,
      sessionId,
      controllerToken,
      controllerLabel: 'Edge on Windows',
      force: true,
      expectedGeneration: 2,
      requestId: 'takeover-casey-1',
    })
    expect(mocks.disconnectProviderCallForTakeover).toHaveBeenCalledWith(`CA${'1'.repeat(32)}`)
    expect(await response.json()).toMatchObject({
      session: { id: sessionId, status: 'active' },
      transferred: true,
      interruption: {
        recorded: true,
        priorStatus: 'connected',
        providerDisconnect: 'disconnected',
      },
    })
  })

  it('requires an exact takeover action and nonnegative integer generation', async () => {
    const response = await POST(controlRequest('POST', {
      action: 'takeover',
      expectedGeneration: 1.5,
    }), context)

    expect(response.status).toBe(400)
    expect(mocks.claimDialerSessionControl).not.toHaveBeenCalled()
  })

  it('rejects null bodies and null generations instead of coercing them to generation zero', async () => {
    const nullBody = await POST(new Request(`https://crm.savingkc.com/api/dialer/sessions/${sessionId}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dialer-Controller': controllerToken },
      body: 'null',
    }), context)
    const nullGeneration = await POST(controlRequest('POST', {
      action: 'takeover',
      expectedGeneration: null,
    }), context)

    expect(nullBody.status).toBe(400)
    expect(nullGeneration.status).toBe(400)
    expect(mocks.claimDialerSessionControl).not.toHaveBeenCalled()
  })

  it('rejects a missing browser controller before reading a takeover body', async () => {
    const input = controlRequest('POST', { action: 'takeover', expectedGeneration: 1 }, false)
    const parse = vi.spyOn(input, 'json')

    const response = await POST(input, context)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'invalid_dialer_controller' })
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.claimDialerSessionControl).not.toHaveBeenCalled()
  })

  it('returns the current safe session context when a takeover race loses', async () => {
    const DialerError = (await import('@/lib/server/dialer-session-engine')).DialerSessionError
    const details = {
      sessionId,
      campaignId: '11111111-1111-4111-8111-111111111111',
      campaignName: 'Jackson Tax',
      status: 'active' as const,
      currentIndex: 4,
      queueSize: 166,
      controllerLabel: 'Chrome on Mac',
      heartbeatAt: '2026-08-31T20:00:00.000Z',
      leaseExpiresAt: '2026-08-31T20:00:45.000Z',
      generation: 4,
      stale: false,
      attemptStatus: null,
      operationActive: false,
      operationLabel: null,
      operationExpiresAt: null,
      canTakeOver: true,
    }
    mocks.claimDialerSessionControl.mockRejectedValue(new DialerError(
      'session_control_changed',
      409,
      'Dialing control changed. Refresh and try again.',
      details,
    ))

    const response = await POST(controlRequest('POST', {
      action: 'takeover',
      expectedGeneration: 3,
    }), context)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: 'session_control_changed',
      details,
    })
  })

  it('rejects unauthenticated heartbeats before controller work', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)

    const response = await PATCH(controlRequest('PATCH'), context)

    expect(response.status).toBe(401)
    expect(mocks.heartbeatDialerSessionControl).not.toHaveBeenCalled()
  })
})
