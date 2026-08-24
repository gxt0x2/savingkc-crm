import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc } }))

import { listProspectingCampaignMembers } from './prospecting-campaign-members'

const actor = { email: 'ernest@savingkc.com', name: 'Ernest' }
const campaignId = '11111111-1111-4111-8111-111111111111'
const row = {
  id: '22222222-2222-4222-8222-222222222222',
  subject_kind: 'lead',
  lead_id: '33333333-3333-4333-8333-333333333333',
  prospect_id: null,
  enrollment_source: 'crm_lead',
  phone_snapshot: '+18165550123',
  timezone: 'America/Chicago',
  status: 'active',
  suppression_reason: null,
  current_step_position: 1,
  next_action_at: null,
  enrolled_at: '2026-08-21T15:00:00.000Z',
  subject_name: 'Helen Seller',
  subject_property_address: '123 Main Street',
  subject_station: 'prospect',
  subject_classification: 'warm',
  ready_contact_count: 2,
  suppressed_contact_count: 1,
}

describe('listProspectingCampaignMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({ data: [row, { ...row, id: '44444444-4444-4444-8444-444444444444' }], error: null })
  })

  it('normalizes full-audience search and returns an opaque query-bound cursor', async () => {
    const page = await listProspectingCampaignMembers(actor, campaignId, { limit: 1, status: 'active', query: '  Helen   Seller ' })
    expect(mocks.rpc).toHaveBeenCalledWith('prospecting_campaign_member_page_v3', {
      p_actor_email: actor.email,
      p_campaign_id: campaignId,
      p_status: 'active',
      p_query: 'helen seller',
      p_limit: 1,
      p_after_enrolled_at: null,
      p_after_id: null,
    })
    expect(page.items).toHaveLength(1)
    expect(page.items[0].lead?.fullName).toBe('Helen Seller')
    expect(page.items[0]).toMatchObject({ subjectKind: 'lead', readyContactCount: 2, suppressedContactCount: 1 })
    expect(page.pageInfo).toMatchObject({ limit: 1, hasMore: true })
    expect(page.pageInfo.nextCursor).toEqual(expect.any(String))
    await expect(listProspectingCampaignMembers(actor, campaignId, {
      limit: 1,
      status: 'active',
      query: 'different seller',
      cursor: page.pageInfo.nextCursor,
    })).rejects.toMatchObject({ code: 'invalid_cursor', status: 400 })
  })

  it('rejects an oversized query before database work', async () => {
    await expect(listProspectingCampaignMembers(actor, campaignId, { query: 'x'.repeat(101) }))
      .rejects.toMatchObject({ code: 'invalid_member_query', status: 400 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
