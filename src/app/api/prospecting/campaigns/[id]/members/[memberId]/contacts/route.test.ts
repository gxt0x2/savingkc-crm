import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), list: vi.fn(), review: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/prospecting-campaign-member-contacts', () => ({
  listProspectingCampaignMemberContacts: mocks.list,
  reviewProspectingCampaignSmsRecipient: mocks.review,
}))

import { GET, PATCH } from './route'

const actor = { email: 'owner@example.com', name: 'Owner' }
const campaignId = '11111111-1111-4111-8111-111111111111'
const memberId = '22222222-2222-4222-8222-222222222222'
const contactId = '33333333-3333-4333-8333-333333333333'
const params = { params: Promise.resolve({ id: campaignId, memberId }) }

describe('prospecting campaign member contacts route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue(actor)
    mocks.list.mockResolvedValue({ contacts: [], campaignStatus: 'draft' })
    mocks.review.mockResolvedValue({ memberId, contactId, status: 'active', phone: '+19135550123' })
  })

  it('rejects anonymous recipient reads before campaign data access', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await GET(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/members/y/contacts'), params)
    expect(response.status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('returns only contacts from the actor-owned campaign member', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/members/y/contacts'), params)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.list).toHaveBeenCalledWith(actor, campaignId, memberId)
  })

  it('records one reviewed recipient without launching or sending', async () => {
    const response = await PATCH(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/members/y/contacts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId }),
    }), params)
    expect(response.status).toBe(200)
    expect(mocks.review).toHaveBeenCalledWith(actor, campaignId, memberId, contactId)
    expect(await response.json()).toEqual({ selection: { memberId, contactId, status: 'active', phone: '+19135550123' } })
  })
})
