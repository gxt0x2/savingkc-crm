import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))

import {
  listProspectingCampaignMemberContacts,
  reviewProspectingCampaignSmsRecipient,
} from './prospecting-campaign-member-contacts'

const actor = { email: 'owner@example.com', name: 'Owner' }
const campaignId = '11111111-1111-4111-8111-111111111111'
const memberId = '22222222-2222-4222-8222-222222222222'
const contactId = '33333333-3333-4333-8333-333333333333'

function singleResult(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }
}

function contactResult(data: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

describe('prospecting campaign member contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockImplementation((table: string) => {
      if (table === 'prospecting_campaigns') return singleResult({ id: campaignId, owner_email: actor.email, kind: 'sms', status: 'draft' })
      if (table === 'prospecting_campaign_members') return singleResult({ id: memberId })
      if (table === 'prospecting_campaign_member_contacts') return contactResult([{
        id: contactId,
        source_kind: 'prospect_phone',
        prospect_id: '44444444-4444-4444-8444-444444444444',
        prospect_phone_id: '55555555-5555-4555-8555-555555555555',
        phone_snapshot: '+19135550123',
        contact_name: 'Jordan Seller',
        relationship: 'owner',
        phone_type: 'mobile',
        status: 'ready',
        suppression_reason: null,
        selected_for_sms: false,
      }])
      throw new Error(`Unexpected table ${table}`)
    })
    mocks.rpc.mockResolvedValue({ data: { memberId, contactId, status: 'active', phone: '+19135550123' }, error: null })
  })

  it('maps bounded immutable snapshots for the actor-owned SMS member', async () => {
    await expect(listProspectingCampaignMemberContacts(actor, campaignId, memberId)).resolves.toEqual({
      campaignStatus: 'draft',
      contacts: [expect.objectContaining({ id: contactId, phone: '+19135550123', selectedForSms: false })],
    })
  })

  it('does not expose contacts from a campaign owned by another actor', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'prospecting_campaigns') return singleResult({ id: campaignId, owner_email: 'other@example.com', kind: 'sms', status: 'draft' })
      throw new Error(`Unexpected table ${table}`)
    })
    await expect(listProspectingCampaignMemberContacts(actor, campaignId, memberId)).rejects.toMatchObject({
      code: 'campaign_not_found',
    })
  })

  it('uses the transaction RPC to persist one reviewed recipient', async () => {
    await expect(reviewProspectingCampaignSmsRecipient(actor, campaignId, memberId, contactId)).resolves.toMatchObject({ status: 'active' })
    expect(mocks.rpc).toHaveBeenCalledWith('review_prospecting_campaign_sms_recipient_v1', {
      p_actor_email: actor.email,
      p_actor_name: actor.name,
      p_campaign_id: campaignId,
      p_member_id: memberId,
      p_contact_id: contactId,
    })
  })
})
