import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))
vi.mock('@/lib/server/dialer-session-engine', () => ({ startDialerSession: vi.fn() }))

import { updateProspectingCampaignDraft } from '@/lib/server/prospecting-campaigns'

const actor = { email: 'ernest@savingkc.com', name: 'Ernest' }
const campaignId = '11111111-1111-4111-8111-111111111111'
const input = {
  name: 'August Absentee corrected',
  kind: 'dialer' as const,
  callerId: '+18166088770',
  fromPhone: null,
  defaultTimezone: 'America/Chicago',
  perHour: 75,
  perDay: 500,
  steps: [],
}

describe('updateProspectingCampaignDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({ data: campaignId, error: { message: 'campaign_setup_locked' } })
  })

  it('rejects malformed campaign ids before calling the database', async () => {
    await expect(updateProspectingCampaignDraft(actor, 'not-a-campaign', input)).rejects.toMatchObject({
      code: 'invalid_campaign_id',
      status: 400,
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('binds the update to the actor and returns an actionable lock conflict', async () => {
    await expect(updateProspectingCampaignDraft(actor, campaignId, input)).rejects.toMatchObject({
      code: 'campaign_setup_locked',
      status: 409,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('update_prospecting_campaign_draft_v1', {
      p_campaign_id: campaignId,
      p_actor_email: actor.email,
      p_actor_name: actor.name,
      p_name: input.name,
      p_kind: input.kind,
      p_caller_id: input.callerId,
      p_from_phone: null,
      p_default_timezone: input.defaultTimezone,
      p_per_hour: input.perHour,
      p_per_day: input.perDay,
      p_steps: [],
    })
  })
})
