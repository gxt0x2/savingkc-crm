import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  getSnapshot: vi.fn(),
}))

vi.mock('@/lib/api/require-authenticated-user', () => ({
  requireAuthenticatedUser: mocks.requireAuthenticatedUser,
}))
vi.mock('@/lib/server/operational-reconciliation', () => ({
  getOperationalReconciliationSnapshot: mocks.getSnapshot,
}))

import { GET } from './route'

describe('operational reconciliation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuthenticatedUser.mockResolvedValue(null)
  })

  it('rejects unauthenticated reads before querying operational data', async () => {
    mocks.requireAuthenticatedUser.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const response = await GET()
    expect(response.status).toBe(401)
    expect(mocks.getSnapshot).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('returns an aggregate-only bounded snapshot', async () => {
    mocks.getSnapshot.mockResolvedValue({
      generatedAt: '2026-08-22T18:00:00.000Z',
      source: 'bounded_server_audit',
      degraded: false,
      warning: null,
      workItems: { total: 208, observed: 208, active: 193, overdue: 175 },
      conversations: { needsReply: 128, observed: 128, known: 20, unmatched: 108 },
    })

    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.workItems.total).toBe(208)
    expect(body.conversations.needsReply).toBe(128)
    expect(response.headers.get('x-reconciliation-degraded')).toBe('false')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('fails honestly when reconciliation cannot be read', async () => {
    mocks.getSnapshot.mockRejectedValue(new Error('database unavailable'))
    const response = await GET()
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Operational reconciliation is unavailable.' })
  })
})
