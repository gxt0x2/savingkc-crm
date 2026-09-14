import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  assertControl: vi.fn(),
  promote: vi.fn(),
  PromotionError: class PromotionError extends Error {
    constructor(readonly status: number, message: string) { super(message) }
  },
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/api/dialer-mutation-control', () => ({
  assertDialerMutationControl: mocks.assertControl,
  dialerMutationControlErrorResponse: () => null,
}))
vi.mock('@/lib/server/prospecting-prospect-promotion', () => ({
  promoteProspectingProspect: mocks.promote,
  ProspectPromotionError: mocks.PromotionError,
}))

import { POST } from './route'

const actor = { email: 'casey@savingkc.com', name: 'Casey' }
const context = { params: Promise.resolve({ id: 'prospect-1' }) }

function request(body: Record<string, unknown>) {
  return new Request('https://crm.savingkc.com/api/prospecting/prospects/prospect-1/promote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/prospecting/prospects/[id]/promote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue(actor)
    mocks.assertControl.mockResolvedValue(null)
    mocks.promote.mockResolvedValue({
      promoted: true,
      lead: { id: 'lead-1', full_name: 'Mojo Contact', phone: '+18165550123' },
    })
  })

  it('promotes only the current session-bound source Prospect', async () => {
    const response = await POST(request({
      dialerSessionId: '11111111-1111-4111-8111-111111111111',
      campaignMemberId: 'member-1',
      presentedPhone: '+18165550123',
    }), context)

    expect(response.status).toBe(201)
    expect(mocks.assertControl).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      sessionId: '11111111-1111-4111-8111-111111111111',
      subject: { prospectId: 'prospect-1', campaignMemberId: 'member-1' },
    }))
    expect(mocks.promote).toHaveBeenCalledWith({
      actor,
      prospectId: 'prospect-1',
      presentedPhone: '+18165550123',
    })
  })

  it('does not promote when dialing control is rejected', async () => {
    mocks.assertControl.mockRejectedValue(new Error('Control lost'))

    const response = await POST(request({ dialerSessionId: 'session-1' }), context)

    expect(response.status).toBe(500)
    expect(mocks.promote).not.toHaveBeenCalled()
  })

  it('returns the reviewed promotion conflict without inventing a Lead', async () => {
    mocks.promote.mockRejectedValue(new mocks.PromotionError(409, 'Add or verify a phone before marking this record as a Lead.'))

    const response = await POST(request({}), context)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: /verify a phone/i })
  })
})
