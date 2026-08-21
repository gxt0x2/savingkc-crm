import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), list: vi.fn(), enroll: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/prospecting-campaigns', () => ({
  ProspectingCampaignError: class ProspectingCampaignError extends Error {},
  enrollProspectingCampaignMembers: mocks.enroll,
}))
vi.mock('@/lib/server/prospecting-campaign-members', () => ({
  CAMPAIGN_MEMBER_FILTERS: ['all', 'active', 'suppressed', 'replied', 'completed', 'removed'],
  listProspectingCampaignMembers: mocks.list,
}))

import { GET } from './route'

const params = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }

describe('prospecting campaign members GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    mocks.list.mockResolvedValue({ items: [], pageInfo: { limit: 50, hasMore: false, nextCursor: null } })
  })

  it('rejects anonymous audience reads before querying campaign data', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await GET(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/members'), params)
    expect(response.status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('passes the bounded cursor and status filter to the actor-owned query', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/members?limit=25&status=replied&cursor=opaque'), params)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.list).toHaveBeenCalledWith(
      { email: 'ernest@savingkc.com', name: 'Ernest' },
      '11111111-1111-4111-8111-111111111111',
      { limit: 25, status: 'replied', cursor: 'opaque' },
    )
  })

  it('rejects unsupported status filters without touching the query', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/members?status=unknown'), params)
    expect(response.status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
