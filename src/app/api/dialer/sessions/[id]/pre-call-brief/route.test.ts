import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveActor: vi.fn(),
  getBrief: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.resolveActor }))
vi.mock('@/lib/server/dialer-pre-call-brief', () => ({ getDialerPreCallBrief: mocks.getBrief }))
vi.mock('@/lib/server/dialer-session-engine', () => ({
  DialerSessionError: class DialerSessionError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message) }
  },
}))

import { GET } from './route'

describe('dialer pre-call brief route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects unsigned browser requests before reading CRM context', async () => {
    mocks.resolveActor.mockResolvedValue(null)
    const response = await GET(new Request('https://crm.test/api/dialer/sessions/session-1/pre-call-brief'), { params: Promise.resolve({ id: 'session-1' }) })
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.getBrief).not.toHaveBeenCalled()
  })

  it('uses the verified actor and emits a no-store timed response', async () => {
    const actor = { email: 'casey@savingkc.com', name: 'Casey' }
    mocks.resolveActor.mockResolvedValue(actor)
    mocks.getBrief.mockResolvedValue({ leadId: 'lead-1', snapshotAt: '2026-08-21T16:00:00Z' })
    const response = await GET(new Request('https://crm.test/api/dialer/sessions/session-1/pre-call-brief'), { params: Promise.resolve({ id: 'session-1' }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('server-timing')).toContain('precall')
    expect(mocks.getBrief).toHaveBeenCalledWith(actor, 'session-1')
  })
})
