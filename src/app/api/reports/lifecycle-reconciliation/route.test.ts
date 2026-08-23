import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }))
vi.mock('@/lib/api/require-authenticated-user', () => ({ requireAuthenticatedUser: mocks.auth }))
vi.mock('@/lib/server/lifecycle-reconciliation', () => ({ getLifecycleReconciliationSnapshot: mocks.read }))

describe('lifecycle reconciliation route', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue(null) })

  it('returns the no-store governed evidence snapshot', async () => {
    mocks.read.mockResolvedValue({ generatedAt: '2026-08-23T18:00:00.000Z', degraded: false, counts: {}, issues: [] })
    const { GET } = await import('./route')
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('server-timing')).toContain('lifecycle-reconciliation')
  })

  it('does not touch evidence data when the request is unauthenticated', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const { GET } = await import('./route')
    expect((await GET()).status).toBe(401)
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
