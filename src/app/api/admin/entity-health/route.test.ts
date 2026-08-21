import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  health: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/server/crm-entity-foundation', () => ({ readCrmEntityHealth: mocks.health }))

import { GET } from './route'

describe('admin CRM entity health', () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue(null)
    mocks.health.mockReset()
  })

  it('rejects unauthorized requests before reading entity data', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const response = await GET(new Request('https://crm.test/api/admin/entity-health') as never)

    expect(response.status).toBe(401)
    expect(mocks.health).not.toHaveBeenCalled()
  })

  it('returns canonical projection health without caching', async () => {
    mocks.health.mockResolvedValue({
      available: true,
      source: 'canonical_projection',
      leads: 362,
      linkedLeads: 362,
      people: 361,
      contactMethods: 445,
      properties: 280,
      opportunities: 362,
      openIdentityConflicts: 0,
      consentEvents: 10,
      projectionCoverage: 1,
    })
    const response = await GET(new Request('https://crm.test/api/admin/entity-health') as never)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toMatchObject({ available: true, projectionCoverage: 1 })
  })

  it('returns an explicit unavailable state while the migration is pending', async () => {
    mocks.health.mockResolvedValue({
      available: false,
      source: 'migration_pending',
      leads: 362,
      linkedLeads: 0,
      people: 0,
      contactMethods: 0,
      properties: 0,
      opportunities: 0,
      openIdentityConflicts: 0,
      consentEvents: 0,
      projectionCoverage: 0,
    })
    const response = await GET(new Request('https://crm.test/api/admin/entity-health') as never)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ source: 'migration_pending' })
  })
})
