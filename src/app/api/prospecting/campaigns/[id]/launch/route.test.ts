import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), launch: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/prospecting-campaigns', () => ({
  ProspectingCampaignError: class ProspectingCampaignError extends Error {
    constructor(
      public code: string,
      public status: number,
      message: string,
      public details?: Record<string, unknown>,
    ) { super(message) }
  },
  launchProspectingDialerCampaign: mocks.launch,
}))

import { POST } from './route'

const context = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }
const controllerToken = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function launchRequest(body?: Record<string, unknown>, controller = true) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/126.0.0.0 Safari/537.36',
  }
  if (controller) headers['X-Dialer-Controller'] = controllerToken
  return new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/launch', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('prospecting campaign launch route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    mocks.launch.mockResolvedValue({ created: false, session: { id: 'session-1' } })
  })

  it('defaults omitted launch behavior to resume', async () => {
    const response = await POST(launchRequest(), context)

    expect(response.status).toBe(201)
    expect(mocks.launch).toHaveBeenCalledWith(
      { email: 'ernest@savingkc.com', name: 'Ernest' },
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        startBehavior: 'resume',
        callerMode: 'static',
        callerIds: ['+18163100845'],
        ringCount: 7,
      }),
      {
        token: controllerToken,
        label: 'Chrome on Mac',
        takeover: false,
        expectedGeneration: null,
        requestId: null,
      },
    )
  })

  it('accepts the deliberate first-unworked behavior', async () => {
    await POST(launchRequest({ startBehavior: 'first_unworked' }), context)

    expect(mocks.launch).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ startBehavior: 'first_unworked' }),
      expect.objectContaining({ token: controllerToken, takeover: false }),
    )
  })

  it('passes an explicit takeover generation and request id to the atomic launch', async () => {
    const response = await POST(launchRequest({
      takeover: true,
      controllerGeneration: 4,
      controllerRequestId: 'takeover-attempt-1',
    }), context)

    expect(response.status).toBe(201)
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.anything(),
      expect.objectContaining({
        takeover: true,
        expectedGeneration: 4,
        requestId: 'takeover-attempt-1',
      }),
    )
  })

  it('requires a stable browser controller before launching a session', async () => {
    const response = await POST(launchRequest({}, false), context)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'invalid_dialer_controller' })
    expect(mocks.launch).not.toHaveBeenCalled()
  })

  it('rejects a stale or malformed takeover generation before session mutation', async () => {
    const response = await POST(launchRequest({ takeover: true, controllerGeneration: -1 }), context)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'invalid_controller_generation' })
    expect(mocks.launch).not.toHaveBeenCalled()
  })

  it('returns conflict context needed to confirm takeover without exposing controller secrets', async () => {
    const CampaignError = (await import('@/lib/server/prospecting-campaigns')).ProspectingCampaignError
    const details = {
      sessionId: '00000000-0000-4000-8000-000000000010',
      campaignId: '11111111-1111-4111-8111-111111111111',
      campaignName: 'Jackson Tax',
      status: 'paused' as const,
      currentIndex: 5,
      queueSize: 166,
      controllerLabel: 'Safari on Mac',
      heartbeatAt: '2026-08-31T20:00:00.000Z',
      leaseExpiresAt: '2026-08-31T20:00:45.000Z',
      generation: 3,
      stale: false,
      attemptStatus: null,
      operationActive: false,
      operationLabel: null,
      operationExpiresAt: null,
      canTakeOver: true,
    }
    mocks.launch.mockRejectedValue(new CampaignError(
      'session_control_conflict',
      409,
      'Another browser is controlling this dialing session',
      details,
    ))

    const response = await POST(launchRequest(), context)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Another browser is controlling this dialing session',
      code: 'session_control_conflict',
      details,
    })
    expect(JSON.stringify(details)).not.toContain(controllerToken)
  })

  it('rejects an unknown start behavior before session mutation', async () => {
    const response = await POST(launchRequest({ startBehavior: 'redial_everyone' }), context)

    expect(response.status).toBe(400)
    expect(mocks.launch).not.toHaveBeenCalled()
  })

  it('rejects non-cold-call lines and oversized rotations before session mutation', async () => {
    const response = await POST(launchRequest({
      callerMode: 'rotation',
      callerIds: ['+18166088588', '+18163100845'],
      ringCount: 7,
    }), context)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'invalid_session_setup' })
    expect(mocks.launch).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON instead of silently resuming', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dialer-Controller': controllerToken },
      body: '{',
    }), context)

    expect(response.status).toBe(400)
    expect(mocks.launch).not.toHaveBeenCalled()
  })

  it('rejects anonymous launches before reading the body', async () => {
    mocks.actor.mockResolvedValue(null)
    const request = new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/launch', { method: 'POST' })
    const parse = vi.spyOn(request, 'text')
    const response = await POST(request, context)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
  })
})
