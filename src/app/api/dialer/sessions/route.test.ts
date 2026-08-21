import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedActor: vi.fn(),
  getDialerSessionHistory: vi.fn(),
  getOpenDialerSession: vi.fn(),
  startDialerSession: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.resolveAuthenticatedActor }))
vi.mock('@/lib/server/dialer-session-engine', () => ({
  DialerSessionError: class DialerSessionError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message) }
  },
  getDialerSessionHistory: mocks.getDialerSessionHistory,
  getOpenDialerSession: mocks.getOpenDialerSession,
  startDialerSession: mocks.startDialerSession,
}))

import { GET, POST } from './route'

function request(body: Record<string, unknown>) {
  return new Request('https://crm.savingkc.com/api/dialer/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('dialer session routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
  })

  it('rejects unauthenticated session creation before parsing the body', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)
    const input = request({ leadIds: [] })
    const parse = vi.spyOn(input, 'json')

    const response = await POST(input)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.startDialerSession).not.toHaveBeenCalled()
  })

  it('uses only the verified actor when creating a session', async () => {
    const session = { id: 'session-1' }
    mocks.startDialerSession.mockResolvedValue({ created: true, session })

    const response = await POST(request({
      leadIds: ['lead-1'],
      queueKey: 'cold_prospecting',
      callerId: '+18167277667',
      actorEmail: 'spoofed@example.com',
      agentName: 'Spoofed',
    }))

    expect(response.status).toBe(201)
    expect(mocks.startDialerSession).toHaveBeenCalledWith(expect.objectContaining({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
    }))
  })

  it('returns the existing open session as a conflict instead of replacing it', async () => {
    mocks.startDialerSession.mockResolvedValue({ created: false, session: { id: 'existing' } })

    const response = await POST(request({ leadIds: ['lead-1'] }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ created: false, session: { id: 'existing' } })
  })

  it('loads only the authenticated actor open session', async () => {
    mocks.getOpenDialerSession.mockResolvedValue({ id: 'session-1' })

    const response = await GET(new Request('https://crm.savingkc.com/api/dialer/sessions'))

    expect(response.status).toBe(200)
    expect(mocks.getOpenDialerSession).toHaveBeenCalledWith({ email: 'casey@savingkc.com', name: 'Casey' })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('returns bounded history for the authenticated actor', async () => {
    mocks.getDialerSessionHistory.mockResolvedValue({
      items: [{ id: 'session-1' }],
      pageInfo: { limit: 10, hasMore: false, nextCursor: null },
    })

    const response = await GET(new Request('https://crm.savingkc.com/api/dialer/sessions?scope=history&limit=10&cursor=opaque'))

    expect(response.status).toBe(200)
    expect(mocks.getDialerSessionHistory).toHaveBeenCalledWith(
      { email: 'casey@savingkc.com', name: 'Casey' },
      { limit: 10, cursor: 'opaque' },
    )
    expect(await response.json()).toMatchObject({ items: [{ id: 'session-1' }] })
  })
})
