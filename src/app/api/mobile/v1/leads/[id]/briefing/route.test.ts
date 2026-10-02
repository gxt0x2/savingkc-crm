import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), state: vi.fn(), reserve: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/mobile-api/authorized-lead', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/authorized-lead')>(),
  requireAuthorizedMobileLead: mocks.authorize,
}))
vi.mock('@/lib/mobile-api/command-receipts', () => ({
  reserveMobileCommand: mocks.reserve,
  mobileCommandPayloadHash: vi.fn(() => 'hash'),
}))
vi.mock('@/lib/server/canonical-lead-briefing', () => ({
  getCanonicalLeadBriefingState: mocks.state,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc }) }))

import { GET, POST } from './route'
import { MobileLeadAccessError } from '@/lib/mobile-api/authorized-lead'

const id = '11111111-1111-4111-8111-111111111111'
const context = { params: Promise.resolve({ id }) }
function request(method = 'GET') {
  return new NextRequest(`https://crm.savingkc.com/api/mobile/v1/leads/${id}/briefing`, {
    method,
    headers: { Authorization: 'Bearer user', 'Idempotency-Key': 'briefing-1' },
  })
}

describe('mobile canonical briefing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({ actor: { email: 'casey@savingkc.com' }, lead: { id } })
    mocks.state.mockResolvedValue({ leadId: id, briefing: null, freshness: 'missing', refresh: null })
    mocks.reserve.mockResolvedValue({ kind: 'reserved', token: 'claim-1' })
    mocks.rpc.mockResolvedValue({ data: { queued: true, leadId: id, revision: 3, status: 'pending' }, error: null })
  })

  it('reads canonical state as the signed-in lead actor', async () => {
    const response = await GET(request(), context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ leadId: id, freshness: 'missing' })
    expect(mocks.authorize).toHaveBeenCalledOnce()
  })

  it('rejects a lead outside the actor scope before reading the briefing', async () => {
    mocks.authorize.mockRejectedValue(new MobileLeadAccessError('outside scope', 403))
    const response = await GET(request(), context)
    expect(response.status).toBe(403)
    expect(mocks.state).not.toHaveBeenCalled()
  })

  it('reserves a refresh and returns the canonical revision', async () => {
    const response = await POST(request('POST'), context)
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ queued: true, leadId: id, revision: 3 })
    expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({ actorEmail: 'casey@savingkc.com', leadId: id }))
    expect(mocks.rpc).toHaveBeenCalledWith('apply_mobile_briefing_refresh_v1', {
      p_actor_email: 'casey@savingkc.com', p_idempotency_key: 'briefing-1', p_lease_token: 'claim-1',
    })
  })
})
