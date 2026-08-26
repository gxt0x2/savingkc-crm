import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  load: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/dialer-daily-performance', () => ({ loadDialerDailyPerformance: mocks.load }))

import { GET } from './route'

describe('today dialer metrics route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey Davis' })
  })

  it('rejects an unauthenticated request before loading metrics', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(401)
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('returns only verified actor metrics without caching', async () => {
    mocks.load.mockResolvedValue({
      generatedAt: '2026-08-25T15:00:00.000Z',
      timeZone: 'America/Chicago',
      rows: [{ metric_date: '2026-08-25', dialing_seconds: 3600, calls: 12, contacts: 3, leads: 1 }],
    })
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({
      actorEmail: 'casey@savingkc.com',
      agentName: 'Casey Davis',
      from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }))
    expect(await response.json()).toMatchObject({ metrics: { calls: 12, contacts: 3, leads: 1 } })
  })

  it('fails visibly instead of turning unavailable metrics into zeroes', async () => {
    mocks.load.mockRejectedValue(new Error('database unavailable'))
    const response = await GET()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Today’s dialer metrics are unavailable' })
  })
})
