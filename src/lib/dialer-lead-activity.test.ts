import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadDialerActivities,
  loadDialerSubjectActivities,
  loadProspectingContactNoteActivities,
} from '@/lib/dialer-lead-activity'

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

  it('loads unpromoted source-Prospect notes without inventing a Lead', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ activities: [{
      id: 'activity-2',
      activity_type: 'note',
      description: 'Sister handles the estate calls.',
      agent: 'Ernest',
      metadata: { source: 'prospecting_contact_note', prospect_id: 'prospect/unsafe' },
      created_at: '2026-08-26T12:00:00.000Z',
    }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await loadProspectingContactNoteActivities('prospect/unsafe')

    expect(fetchMock).toHaveBeenCalledWith('/api/prospecting/contact-notes?prospect_id=prospect%2Funsafe', { cache: 'no-store' })
    expect(result).toHaveLength(1)
  })

  it('prefers canonical Lead history after a source Prospect is promoted', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ activities: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await loadDialerSubjectActivities({ leadId: 'lead-1', prospectId: 'prospect-1' })

    expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1/activities?limit=50', { cache: 'no-store' })
  })
})
