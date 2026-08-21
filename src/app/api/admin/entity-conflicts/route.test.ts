import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/server/crm-entity-conflicts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/crm-entity-conflicts')>()
  return { ...original, readCrmEntityConflictsPage: mocks.read }
})

import { InvalidEntityConflictCursorError } from '@/lib/server/crm-entity-conflicts'
import { GET } from './route'

describe('admin CRM entity conflicts', () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue(null)
    mocks.read.mockReset()
  })

  it('rejects unauthorized requests before reading canonical identity data', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const response = await GET(new Request('https://crm.test/api/admin/entity-conflicts') as never)
    expect(response.status).toBe(401)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('returns a bounded conflict page without caching', async () => {
    mocks.read.mockResolvedValue({ items: [], pageInfo: { limit: 10, hasMore: false, nextCursor: null } })
    const response = await GET(new Request('https://crm.test/api/admin/entity-conflicts?limit=10') as never)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.read).toHaveBeenCalledWith({ limit: '10', cursor: null })
  })

  it('rejects malformed cursors and contains database failures', async () => {
    mocks.read.mockRejectedValueOnce(new InvalidEntityConflictCursorError())
    const invalid = await GET(new Request('https://crm.test/api/admin/entity-conflicts?cursor=bad') as never)
    expect(invalid.status).toBe(400)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.read.mockRejectedValueOnce(new Error('database detail'))
    const failed = await GET(new Request('https://crm.test/api/admin/entity-conflicts') as never)
    expect(failed.status).toBe(503)
    await expect(failed.json()).resolves.toEqual({ error: 'CRM entity conflicts are unavailable.' })
    consoleSpy.mockRestore()
  })
})
