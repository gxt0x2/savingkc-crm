import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), run: vi.fn() }))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.authorize }))
vi.mock('@/lib/server/crm-property-enrichment-jobs', () => ({ runPropertyEnrichmentWorker: mocks.run }))

import { GET } from './route'

describe('property enrichment worker route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue(null)
    mocks.run.mockResolvedValue({ claimed: 0, completed: 0, pending: 0, failed: 0, results: [] })
  })

  it('rejects before claiming work when the worker is unauthorized', async () => {
    mocks.authorize.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const response = await GET(new Request('https://crm.savingkc.com/api/workers/property-enrichment'))
    expect(response.status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('caps a requested batch at five and disables caching', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/workers/property-enrichment?limit=99'))
    expect(response.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledWith(5)
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
})

