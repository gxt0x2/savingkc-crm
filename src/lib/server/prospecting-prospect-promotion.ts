import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import type { ProspectMatch } from '@/lib/prospect-lookup'
import { createEnrichedLeadFromProspect } from '@/lib/prospect-to-lead'
import { supabase } from '@/lib/supabase-lazy'

const PROSPECT_SELECT = 'id,lead_id,parcel_id,county,situs_address,situs_street,situs_city,situs_state,situs_zip,owner_1,owner_1_first,owner_1_last,owner_1_type,mailing_street,mailing_city,mailing_state,mailing_zip,cumulative_due,earliest_delinquent_year,delinquent_years_category,total_market_value,zestimate,occupancy_status,is_deceased,is_skip_traced,owner_age,email_1,email_2'
const LEAD_SELECT = 'id,full_name,phone,email,property_address,city,state,zip,county,is_favorite'

type ProspectRow = Omit<ProspectMatch, 'prospect_id' | 'phone_type' | 'contact_name' | 'relationship'> & {
  id: string
}

type ProspectPhone = {
  phone: string
  phone_type: string | null
  contact_name: string | null
  relationship: string | null
  is_verified_contact: boolean | null
}

export class ProspectPromotionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

function choosePhone(phones: ProspectPhone[], requestedPhone: string | null): ProspectPhone | null {
  const requested = requestedPhone ? normalizePhoneToE164(requestedPhone) : null
  if (requested) {
    const exact = phones.find((item) => normalizePhoneToE164(item.phone) === requested)
    if (!exact) throw new ProspectPromotionError(409, 'The presented phone no longer belongs to this source Prospect.')
    return exact
  }
  return phones.find((item) => item.is_verified_contact) ?? phones[0] ?? null
}

export async function promoteProspectingProspect(input: {
  actor: AuthenticatedActor
  prospectId: string
  presentedPhone: string | null
}) {
  const prospectResult = await supabase.from('prospects').select(PROSPECT_SELECT).eq('id', input.prospectId).single<ProspectRow>()
  if (prospectResult.error || !prospectResult.data) {
    throw new ProspectPromotionError(prospectResult.error?.code === 'PGRST116' ? 404 : 503, prospectResult.error?.code === 'PGRST116' ? 'Source Prospect not found.' : 'Source Prospect could not be loaded.')
  }

  const prospect = prospectResult.data
  let leadId = prospect.lead_id
  let promoted = false
  if (!leadId) {
    const phoneResult = await supabase
      .from('prospect_phones')
      .select('phone,phone_type,contact_name,relationship,is_verified_contact')
      .eq('prospect_id', input.prospectId)
      .limit(100)
    if (phoneResult.error) throw new ProspectPromotionError(503, 'Source Prospect phones could not be loaded.')
    const phone = choosePhone((phoneResult.data ?? []) as ProspectPhone[], input.presentedPhone)
    if (!phone) throw new ProspectPromotionError(409, 'Add or verify a phone before marking this record as a Lead.')

    const match: ProspectMatch = {
      ...prospect,
      prospect_id: prospect.id,
      phone_type: phone.phone_type,
      contact_name: phone.contact_name,
      relationship: phone.relationship,
    }
    leadId = await createEnrichedLeadFromProspect(match, normalizePhoneToE164(phone.phone) ?? phone.phone, 'heir_dialer', 'warm')
    if (!leadId) throw new ProspectPromotionError(503, 'The Lead record could not be created.')
    promoted = true
  }

  const now = new Date().toISOString()
  const updateResult = await supabase.from('leads').update({
    classification: 'lead',
    station: 'contacted',
    updated_at: now,
  }).eq('id', leadId)
  if (updateResult.error) throw new ProspectPromotionError(503, 'The record was linked but its Lead status could not be saved.')

  const evidenceResult = await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'status_change',
    description: `${prospect.owner_1 || 'Source Prospect'} marked as a Lead from the live calling workspace.`,
    agent: input.actor.name,
    metadata: {
      source: 'prospecting_calling_floor',
      action: 'mark_as_lead',
      prospect_id: prospect.id,
      promoted,
    },
  })
  if (evidenceResult.error) throw new ProspectPromotionError(503, 'Lead status was saved, but its audit entry could not be recorded.')

  const leadResult = await supabase.from('leads').select(LEAD_SELECT).eq('id', leadId).single()
  if (leadResult.error || !leadResult.data) throw new ProspectPromotionError(503, 'Lead status was saved, but the refreshed record could not be loaded.')
  return { lead: leadResult.data, promoted }
}
