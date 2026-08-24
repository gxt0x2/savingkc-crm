import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import type { ProspectingCampaignMemberContact } from '@/lib/prospecting/campaign-contract'
import { ProspectingCampaignError } from '@/lib/server/prospecting-campaigns'
import { supabase } from '@/lib/supabase-lazy'

type CampaignRow = { id: string; owner_email: string; kind: 'dialer' | 'sms'; status: string }
type ContactRow = {
  id: string
  source_kind: 'prospect_phone' | 'lead_primary'
  prospect_id: string | null
  prospect_phone_id: string | null
  phone_snapshot: string
  contact_name: string | null
  relationship: string | null
  phone_type: string | null
  status: 'ready' | 'suppressed' | 'removed'
  suppression_reason: string | null
  selected_for_sms: boolean
}

function validId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function requireOwnedSmsMember(actor: AuthenticatedActor, campaignId: string, memberId: string) {
  if (!validId(campaignId) || !validId(memberId)) {
    throw new ProspectingCampaignError('invalid_campaign_member', 400, 'Campaign member is invalid')
  }
  const campaignResult = await supabase
    .from('prospecting_campaigns')
    .select('id,owner_email,kind,status')
    .eq('id', campaignId)
    .maybeSingle()
  if (campaignResult.error) throw new ProspectingCampaignError('campaign_engine_unavailable', 503, 'Campaign audience is unavailable')
  const campaign = campaignResult.data as CampaignRow | null
  if (!campaign || campaign.owner_email.trim().toLowerCase() !== actor.email.trim().toLowerCase()) {
    throw new ProspectingCampaignError('campaign_not_found', 404, 'Campaign not found')
  }
  if (campaign.kind !== 'sms') throw new ProspectingCampaignError('recipient_review_not_sms', 409, 'Recipient review applies only to SMS campaigns')

  const memberResult = await supabase
    .from('prospecting_campaign_members')
    .select('id')
    .eq('id', memberId)
    .eq('campaign_id', campaignId)
    .maybeSingle()
  if (memberResult.error) throw new ProspectingCampaignError('campaign_engine_unavailable', 503, 'Campaign audience is unavailable')
  if (!memberResult.data) throw new ProspectingCampaignError('campaign_member_not_found', 404, 'Campaign member not found')
  return campaign
}

export async function listProspectingCampaignMemberContacts(
  actor: AuthenticatedActor,
  campaignId: string,
  memberId: string,
): Promise<{ contacts: ProspectingCampaignMemberContact[]; campaignStatus: string }> {
  const campaign = await requireOwnedSmsMember(actor, campaignId, memberId)
  const result = await supabase
    .from('prospecting_campaign_member_contacts')
    .select('id,source_kind,prospect_id,prospect_phone_id,phone_snapshot,contact_name,relationship,phone_type,status,suppression_reason,selected_for_sms')
    .eq('member_id', memberId)
    .order('enrolled_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(100)
  if (result.error) throw new ProspectingCampaignError('campaign_engine_unavailable', 503, 'Campaign recipients are unavailable')
  const contacts = ((result.data || []) as ContactRow[]).map((row) => ({
    id: row.id,
    sourceKind: row.source_kind,
    prospectId: row.prospect_id,
    prospectPhoneId: row.prospect_phone_id,
    phone: row.phone_snapshot,
    contactName: row.contact_name,
    relationship: row.relationship,
    phoneType: row.phone_type,
    status: row.status,
    suppressionReason: row.suppression_reason,
    selectedForSms: row.selected_for_sms,
  }))
  return { contacts, campaignStatus: campaign.status }
}

export async function reviewProspectingCampaignSmsRecipient(
  actor: AuthenticatedActor,
  campaignId: string,
  memberId: string,
  contactId: string,
) {
  if (!validId(contactId)) throw new ProspectingCampaignError('invalid_campaign_contact', 400, 'Campaign recipient is invalid')
  await requireOwnedSmsMember(actor, campaignId, memberId)
  const result = await supabase.rpc('review_prospecting_campaign_sms_recipient_v1', {
    p_actor_email: actor.email,
    p_actor_name: actor.name,
    p_campaign_id: campaignId,
    p_member_id: memberId,
    p_contact_id: contactId,
  })
  if (result.error) {
    const message = String(result.error.message || '').toLowerCase()
    if (message.includes('campaign_members_locked')) throw new ProspectingCampaignError('campaign_members_locked', 409, 'Pause this campaign before reviewing a recipient')
    if (message.includes('campaign_contact_not_eligible')) throw new ProspectingCampaignError('campaign_contact_not_eligible', 409, 'That phone is suppressed and cannot be selected')
    if (message.includes('campaign_contact_not_found') || message.includes('campaign_member_not_found')) {
      throw new ProspectingCampaignError('campaign_contact_not_found', 404, 'Campaign recipient not found')
    }
    throw new ProspectingCampaignError('campaign_engine_unavailable', 503, 'Campaign recipient could not be saved')
  }
  return result.data as { memberId: string; contactId: string; status: 'active'; phone: string }
}
