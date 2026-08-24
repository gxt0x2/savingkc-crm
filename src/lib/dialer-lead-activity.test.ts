import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadDialerActivities } from '@/lib/dialer-lead-activity'

describe('dialer lead context', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('loads bounded activity through the authenticated activity API', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/activities?limit=50')) {
        return new Response(JSON.stringify({ activities: [{
          id: 'activity-1',
          activity_type: 'call',
          description: 'Connected',
          agent: 'Ernest',
          metadata: null,
          created_at: '2026-08-23T12:00:00.000Z',
        }] }), { status: 200 })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await loadDialerActivities('lead/unsafe')

    expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead%2Funsafe/activities?limit=50', { cache: 'no-store' })
    expect(result).toHaveLength(1)
  })
})
