import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/prospecting-campaigns', () => ({
  ProspectingCampaignError: class ProspectingCampaignError extends Error {},
  createProspectingCampaign: mocks.create,
  listProspectingCampaigns: mocks.list,
}))

import { GET, POST } from './route'

describe('prospecting campaigns route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
  })

  it('rejects anonymous writes before parsing the request body', async () => {
    mocks.actor.mockResolvedValue(null)
    const request = new Request('https://crm.savingkc.com/api/prospecting/campaigns', { method: 'POST', body: '{}' })
    const parse = vi.spyOn(request, 'json')
    const response = await POST(request)
    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('creates an SMS campaign with the verified actor', async () => {
    mocks.create.mockResolvedValue({ id: 'campaign-1' })
    const response = await POST(new Request('https://crm.savingkc.com/api/prospecting/campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Absentee owners',
        kind: 'sms',
        fromPhone: '+18163077835',
        steps: [{ delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}' }],
      }),
    }))
    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith(
      { email: 'casey@savingkc.com', name: 'Casey' },
      expect.objectContaining({ kind: 'sms', fromPhone: '+18163077835' }),
    )
  })

  it('returns cursor-bounded actor-owned campaigns', async () => {
    mocks.list.mockResolvedValue({ items: [], pageInfo: { hasMore: false, nextCursor: null, limit: 10 } })
    const response = await GET(new Request('https://crm.savingkc.com/api/prospecting/campaigns?limit=10&cursor=opaque'))
    expect(response.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith(
      { email: 'casey@savingkc.com', name: 'Casey' },
      { limit: 10, cursor: 'opaque' },
    )
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
})
