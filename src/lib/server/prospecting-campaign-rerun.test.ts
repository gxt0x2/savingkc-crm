import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))

import { rerunProspectingDialerCampaign } from './prospecting-campaigns'

const campaignId = '11111111-1111-4111-8111-111111111111'
const actor = { email: 'ernest@savingkc.com', name: 'Ernest' }

describe('rerunProspectingDialerCampaign', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the atomic owner-scoped rerun command and verifies its result', async () => {
    mocks.rpc.mockResolvedValue({
      data: { id: campaignId, status: 'active', runNumber: 2, resetMembers: 61 },
      error: null,
    })

    await expect(rerunProspectingDialerCampaign(actor, campaignId)).resolves.toEqual({
      id: campaignId,
      status: 'active',
      runNumber: 2,
      resetMembers: 61,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('rerun_prospecting_dialer_campaign_v1', {
      p_campaign_id: campaignId,
      p_actor_email: actor.email,
      p_actor_name: actor.name,
    })
  })

  it('rejects malformed database results rather than inventing a new run', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: campaignId, status: 'active', runNumber: 1, resetMembers: 0 }, error: null })

    await expect(rerunProspectingDialerCampaign(actor, campaignId)).rejects.toMatchObject({
      code: 'invalid_campaign_payload',
      status: 503,
    })
  })
})
