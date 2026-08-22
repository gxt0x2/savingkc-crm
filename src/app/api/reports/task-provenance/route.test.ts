import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  getSummary: vi.fn(),
}))

vi.mock('@/lib/api/require-authenticated-user', () => ({
  requireAuthenticatedUser: mocks.requireAuthenticatedUser,
}))
vi.mock('@/lib/server/task-provenance', () => ({
  getTaskProvenanceSummary: mocks.getSummary,
}))

import { GET } from './route'

describe('task provenance report route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuthenticatedUser.mockResolvedValue(null)
  })

  it('rejects unauthenticated reads before querying source evidence', async () => {
    mocks.requireAuthenticatedUser.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const response = await GET()
    expect(response.status).toBe(401)
    expect(mocks.getSummary).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('returns only the aggregate census with private no-store caching', async () => {
    mocks.getSummary.mockResolvedValue({
      schemaVersion: 1,
      department: 'acquisitions',
      generatedAt: '2026-08-22T21:00:00.000Z',
      source: 'aggregate_database_census',
      total: 208,
      active: 193,
      completed: 15,
      classes: {},
      knownSources: {},
      quality: {},
      quarantineApplied: false,
    })
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ total: 208, active: 193, quarantineApplied: false })
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('server-timing')).toContain('task-provenance')
  })

  it('returns an honest 503 when the census is unavailable', async () => {
    mocks.getSummary.mockRejectedValue(new Error('database unavailable'))
    const response = await GET()
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Task integrity evidence is unavailable.' })
  })
})
