import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  decodeContactDirectoryCursor,
  encodeContactDirectoryCursor,
  readContactDirectoryPage,
} from './contact-directory-read-model'

describe('contact directory read model', () => {
  it('round-trips an opaque keyset cursor and rejects malformed input', () => {
    const cursor = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'seller one',
      lastActivityAt: '2026-08-21T12:00:00.000Z',
      score: 82,
      attentionRank: 0,
    }
    expect(decodeContactDirectoryCursor(encodeContactDirectoryCursor(cursor))).toEqual(cursor)
    expect(decodeContactDirectoryCursor('not-a-cursor')).toBeNull()
  })

  it('calls the bounded page RPC and normalizes metadata', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        items: [{ id: '00000000-0000-4000-8000-000000000001' }],
        total_count: 17,
        has_more: true,
        next_cursor: {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'seller one',
          lastActivityAt: '2026-08-21T12:00:00.000Z',
          score: 82,
          attentionRank: 0,
        },
        scope_counts: { active: 17, prospects: 4, not_leads: 2 },
        smart_list_counts: { new: 6, all: 17 },
        owners: ['Ernest'],
        sources: ['website_form'],
        tags: [],
      }],
      error: null,
    })
    const query = {
      smartList: 'new', scope: 'active', limit: 10, cursor: null, sort: 'priority',
      search: '', owner: '', stage: '', minimumStage: '', source: '', tag: '',
      activity: '', attention: '', outreach: '', dataGap: '',
      referenceTime: '2026-08-21T12:00:00.000Z',
    }

    const page = await readContactDirectoryPage(query, { rpc })

    expect(rpc).toHaveBeenCalledWith('contact_workspace_page_v3', expect.objectContaining({
      target_smart_list: 'new',
      target_limit: 10,
      page_cursor: null,
    }))
    expect(page).toMatchObject({
      totalCount: 17,
      hasMore: true,
      scopeCounts: { active: 17, prospects: 4, not_leads: 2 },
      smartListCounts: { new: 6, all: 17 },
      facets: { owners: ['Ernest'], sources: ['website_form'], tags: [] },
    })
    expect(decodeContactDirectoryCursor(page.nextCursor)).toMatchObject({ score: 82 })
  })
})
