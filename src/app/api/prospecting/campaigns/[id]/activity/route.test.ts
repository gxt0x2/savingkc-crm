import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), list: vi.fn() }))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/prospecting-campaign-activity', () => ({ listProspectingCampaignActivity: mocks.list }))

import { GET } from './route'

const params = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }

describe('prospecting campaign activity route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.list.mockResolvedValue({ items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } })
  })

  it('rejects anonymous reads before campaign access', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await GET(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/activity'), params)
    expect(response.status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('returns actor-owned cursor-bounded history without caching', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/activity?limit=10&cursor=opaque&filter=failures'), params)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.list).toHaveBeenCalledWith(
      { email: 'casey@savingkc.com', name: 'Casey' },
      '11111111-1111-4111-8111-111111111111',
      { limit: 10, cursor: 'opaque', filter: 'failures' },
    )
  })
})
