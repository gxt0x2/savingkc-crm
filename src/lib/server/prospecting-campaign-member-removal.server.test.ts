import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('@/lib/server/dialer-session-engine', () => ({ startDialerSession: vi.fn() }))

import { ProspectingCampaignError, removeProspectingCampaignMember } from '@/lib/server/prospecting-campaigns'

const actor = { email: 'ernest@savingkc.com', name: 'Ernest' }
const campaignId = '11111111-1111-4111-8111-111111111111'
const memberId = '22222222-2222-4222-8222-222222222222'

describe('removeProspectingCampaignMember', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({
      data: { id: memberId, status: 'removed', removed: true, cancelledActions: 1 },
      error: null,
    })
  })

  it('binds the member mutation to the authenticated actor', async () => {
    await expect(removeProspectingCampaignMember(actor, campaignId, memberId)).resolves.toMatchObject({ status: 'removed', cancelledActions: 1 })
    expect(mocks.rpc).toHaveBeenCalledWith('remove_prospecting_campaign_member_v1', {
      p_campaign_id: campaignId,
      p_member_id: memberId,
      p_actor_email: actor.email,
      p_actor_name: actor.name,
    })
  })

  it('rejects malformed ids before touching the database', async () => {
    await expect(removeProspectingCampaignMember(actor, 'not-a-campaign', memberId)).rejects.toMatchObject({
      code: 'invalid_campaign_member',
      status: 400,
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('turns the database live-campaign lock into an actionable conflict', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'campaign_members_locked' } })
    await expect(removeProspectingCampaignMember(actor, campaignId, memberId)).rejects.toEqual(expect.objectContaining<Partial<ProspectingCampaignError>>({
      code: 'invalid_campaign_state',
      status: 409,
      message: 'Pause the campaign before changing its audience',
    }))
  })
})
