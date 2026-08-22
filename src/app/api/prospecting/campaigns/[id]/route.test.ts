import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), get: vi.fn(), transition: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/prospecting-campaigns', () => ({
  ProspectingCampaignError: class ProspectingCampaignError extends Error {},
  getProspectingCampaign: mocks.get,
  setProspectingCampaignStatus: mocks.transition,
}))

import { PATCH } from './route'

const params = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }

describe('prospecting campaign transition route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    mocks.transition.mockResolvedValue({ id: 'campaign-1', status: 'active' })
  })

  it('rejects anonymous transitions before parsing the body', async () => {
    mocks.actor.mockResolvedValue(null)
    const request = new Request('https://crm.savingkc.com/api/prospecting/campaigns/x', { method: 'PATCH', body: '{}' })
    const parse = vi.spyOn(request, 'json')
    const response = await PATCH(request, params)
    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.transition).not.toHaveBeenCalled()
  })

  it('requires an explicit reviewed activation confirmation', async () => {
    const response = await PATCH(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x', { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }), params)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'activation_confirmation_required' })
    expect(mocks.transition).not.toHaveBeenCalled()
  })

  it('activates only after the authenticated operator confirms', async () => {
    const response = await PATCH(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x', { method: 'PATCH', body: JSON.stringify({ status: 'active', confirmed: true }) }), params)
    expect(response.status).toBe(200)
    expect(mocks.transition).toHaveBeenCalledWith({ email: 'ernest@savingkc.com', name: 'Ernest' }, '11111111-1111-4111-8111-111111111111', 'active')
  })
})
