import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), list: vi.fn(), enroll: vi.fn(), enrollCounty: vi.fn(), enrollCountyByIds: vi.fn(), enrollSelection: vi.fn(), parseSelection: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/prospecting-campaigns', () => ({
  ProspectingCampaignError: class ProspectingCampaignError extends Error {
    constructor(public code: string, public status: number, message: string) {
      super(message)
    }
  },
  enrollProspectingCampaignMembers: mocks.enroll,
  enrollCountyProspectingCampaignMembers: mocks.enrollCounty,
  enrollCountyProspectingCampaignMembersByIds: mocks.enrollCountyByIds,
  removeProspectingCampaignMember: mocks.remove,
}))
vi.mock('@/lib/server/prospecting-campaign-members', () => ({
  CAMPAIGN_MEMBER_FILTERS: ['all', 'active', 'suppressed', 'replied', 'completed', 'removed'],
  listProspectingCampaignMembers: mocks.list,
}))
vi.mock('@/lib/server/prospecting-audience-selection', () => ({
  enrollProspectingAudienceSelection: mocks.enrollSelection,
  parseProspectingAudienceSelection: mocks.parseSelection,
}))

import { DELETE, GET, POST } from './route'

const params = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }

describe('prospecting campaign members GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    mocks.list.mockResolvedValue({ items: [], pageInfo: { limit: 50, hasMore: false, nextCursor: null } })
    mocks.parseSelection.mockReturnValue({ mode: 'query', query: { smartList: 'prospects' }, count: 11 })
    mocks.enrollSelection.mockResolvedValue({ requested: 11, eligible: 9, suppressed: 1, missing: 1 })
    mocks.remove.mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222', status: 'removed', removed: true, cancelledActions: 1 })
    mocks.enrollCountyByIds.mockResolvedValue({ requested: 2, subjects: 2, eligible: 2, needsReview: 0, suppressed: 0, missing: 0 })
  })

  it('enrolls an exact Jackson parcel set and does not touch the 2-year Saved View path', async () => {
    const parcelIds = ['SYN-JACKSON-PARCEL-0001', 'SYN-JACKSON-PARCEL-0002']
    const response = await POST(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countyAudience: { parcelIds, reviewedCount: 2 } }),
    }), params)
    expect(response.status).toBe(200)
    expect(mocks.enrollCountyByIds).toHaveBeenCalledWith(
      { email: 'ernest@savingkc.com', name: 'Ernest' },
      '11111111-1111-4111-8111-111111111111',
      { parcelIds, reviewedCount: 2 },
    )
    expect(mocks.enrollCounty).not.toHaveBeenCalled()
    expect(mocks.enroll).not.toHaveBeenCalled()
    expect(mocks.enrollCountyByIds.mock.calls[0][1]).not.toBe('5c45d2f7-c120-4477-bb1f-f04d69c4efdf')
  })

  it('rejects parcel enrollment against an active campaign without calling Saved View enroll', async () => {
    const { ProspectingCampaignError } = await import('@/lib/server/prospecting-campaigns')
    mocks.enrollCountyByIds.mockRejectedValue(new ProspectingCampaignError('invalid_campaign_state', 409, 'Pause the campaign before changing its audience'))
    const response = await POST(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countyAudience: { parcelIds: ['SYN-JACKSON-PARCEL-0001'], reviewedCount: 1 } }),
    }), params)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_campaign_state' })
    expect(mocks.enrollCounty).not.toHaveBeenCalled()
    expect(mocks.enrollCountyByIds.mock.calls[0][1]).not.toBe('5c45d2f7-c120-4477-bb1f-f04d69c4efdf')
  })

  it('rejects a reviewedCount that does not match the parcel list before enrollment', async () => {
    const { ProspectingCampaignError } = await import('@/lib/server/prospecting-campaigns')
    mocks.enrollCountyByIds.mockRejectedValue(new ProspectingCampaignError('county_audience_changed', 409, 'The county Saved View changed after review. Refresh it and confirm the current audience'))
    const response = await POST(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countyAudience: { parcelIds: ['SYN-JACKSON-PARCEL-0001'], reviewedCount: 2 } }),
    }), params)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'county_audience_changed' })
    expect(mocks.enrollCounty).not.toHaveBeenCalled()
  })

  it('resolves a full-results selection on the server before campaign enrollment', async () => {
    const selection = { mode: 'query', query: { smartList: 'prospects', sort: 'priority' }, count: 11 }
    const response = await POST(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selection }),
    }), params)
    expect(response.status).toBe(200)
    expect(mocks.parseSelection).toHaveBeenCalledWith(selection)
    expect(mocks.enrollSelection).toHaveBeenCalledWith(
      { email: 'ernest@savingkc.com', name: 'Ernest' },
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ mode: 'query', count: 11 }),
    )
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it('rejects anonymous audience reads before querying campaign data', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await GET(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/members'), params)
    expect(response.status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('passes the bounded cursor, status, and full-audience search to the actor-owned query', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/members?limit=25&status=replied&cursor=opaque&q=Helen%20Seller'), params)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.list).toHaveBeenCalledWith(
      { email: 'ernest@savingkc.com', name: 'Ernest' },
      '11111111-1111-4111-8111-111111111111',
      { limit: 25, status: 'replied', cursor: 'opaque', query: 'Helen Seller' },
    )
  })

  it('rejects unsupported status filters without touching the query', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/members?status=unknown'), params)
    expect(response.status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('rejects anonymous removals before reading the request body or mutating campaign state', async () => {
    mocks.actor.mockResolvedValue(null)
    const request = new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/members', { method: 'DELETE' })
    const response = await DELETE(request, params)
    expect(response.status).toBe(401)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('removes one actor-owned campaign member through the server boundary', async () => {
    const memberId = '22222222-2222-4222-8222-222222222222'
    const response = await DELETE(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/members', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    }), params)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.remove).toHaveBeenCalledWith(
      { email: 'ernest@savingkc.com', name: 'Ernest' },
      '11111111-1111-4111-8111-111111111111',
      memberId,
    )
  })
})
