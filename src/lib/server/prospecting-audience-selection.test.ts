import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ readPage: vi.fn(), decodeCursor: vi.fn(), enroll: vi.fn() }))
vi.mock('@/lib/server/contact-directory-read-model', () => ({
  readContactDirectoryPage: mocks.readPage,
  decodeContactDirectoryCursor: mocks.decodeCursor,
}))
vi.mock('@/lib/server/prospecting-campaigns', () => ({
  ProspectingCampaignError: class ProspectingCampaignError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message) }
  },
  enrollProspectingCampaignMembers: mocks.enroll,
}))

import { enrollProspectingAudienceSelection, parseProspectingAudienceSelection } from './prospecting-audience-selection'

const actor = { email: 'ernest@savingkc.com', name: 'Ernest' }
const campaignId = '11111111-1111-4111-8111-111111111111'
const firstLead = '22222222-2222-4222-8222-222222222222'
const secondLead = '33333333-3333-4333-8333-333333333333'
const query = {
  smartList: 'prospects', sort: 'priority' as const, search: 'absentee', owner: '', stage: '', minimumStage: '',
  source: '', tag: '', activity: '', attention: '', outreach: '', dataGap: '',
}

describe('prospecting full-results audience selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.decodeCursor.mockReturnValue({ id: firstLead, name: '', lastActivityAt: '2026-08-21T00:00:00Z', score: 0, attentionRank: 0 })
    mocks.enroll.mockResolvedValue({ requested: 2, eligible: 2, suppressed: 0, missing: 0 })
  })

  it('walks the server-owned cursor and enrolls the complete matching result set once', async () => {
    mocks.readPage
      .mockResolvedValueOnce({ items: [{ id: firstLead }], totalCount: 2, hasMore: true, nextCursor: 'cursor', scopeCounts: {}, smartListCounts: {}, facets: {} })
      .mockResolvedValueOnce({ items: [{ id: secondLead }], totalCount: 2, hasMore: false, nextCursor: null, scopeCounts: {}, smartListCounts: {}, facets: {} })

    const result = await enrollProspectingAudienceSelection(actor, campaignId, { mode: 'query', query, count: 2 })
    expect(result).toMatchObject({ eligible: 2 })
    expect(mocks.readPage).toHaveBeenCalledTimes(2)
    expect(mocks.readPage).toHaveBeenNthCalledWith(1, expect.objectContaining({ smartList: 'prospects', scope: 'prospects', limit: 50, cursor: null }))
    expect(mocks.enroll).toHaveBeenCalledWith(actor, campaignId, [firstLead, secondLead])
  })

  it('refuses an oversized result set before enrollment', async () => {
    mocks.readPage.mockResolvedValue({ items: [{ id: firstLead }], totalCount: 1001, hasMore: true, nextCursor: 'cursor', scopeCounts: {}, smartListCounts: {}, facets: {} })
    await expect(enrollProspectingAudienceSelection(actor, campaignId, { mode: 'query', query, count: 1000 })).rejects.toMatchObject({ code: 'audience_too_large', status: 400 })
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it('requires a fresh review when the matching count changed after selection', async () => {
    mocks.readPage.mockResolvedValue({ items: [{ id: firstLead }], totalCount: 1, hasMore: false, nextCursor: null, scopeCounts: {}, smartListCounts: {}, facets: {} })
    await expect(enrollProspectingAudienceSelection(actor, campaignId, { mode: 'query', query, count: 2 })).rejects.toMatchObject({ code: 'audience_changed', status: 409 })
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it('validates query selection shape and preserves explicit id selection', () => {
    expect(parseProspectingAudienceSelection({ mode: 'ids', leadIds: [firstLead] })).toEqual({ mode: 'ids', leadIds: [firstLead], count: 1 })
    expect(() => parseProspectingAudienceSelection({ mode: 'query', count: 2, query: { ...query, sort: 'random' } })).toThrow('Campaign audience filters are invalid')
  })
})
