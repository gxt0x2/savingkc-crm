import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), process: vi.fn() }))
vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/server/prospecting-campaign-worker', () => ({ processProspectingCampaignActions: mocks.process }))

import { GET, POST } from './route'

describe('prospecting campaign worker route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
    mocks.process.mockResolvedValue({ processed: 2, sent: 1, deferred: 1, blocked: 0, failed: 0 })
  })

  it('does no work for an unauthorized request', async () => {
    mocks.auth.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const response = await POST(new Request('https://crm.savingkc.com/api/workers/prospecting-campaigns', { method: 'POST' }))
    expect(response.status).toBe(401)
    expect(mocks.process).not.toHaveBeenCalled()
  })

  it('caps work in the engine and returns a no-store summary', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/workers/prospecting-campaigns?limit=25'))
    expect(response.status).toBe(200)
    expect(mocks.process).toHaveBeenCalledWith(25)
    expect(await response.json()).toMatchObject({ processed: 2, sent: 1 })
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
})
