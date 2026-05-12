import { createClient } from '@supabase/supabase-js'
import { buildManifest } from './manifest-builder'
import { onCommunicationEvent } from './manifest-sync'
import type { ProspectMatch } from './prospect-lookup'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * Create an enriched lead from a prospect match.
 * Pre-fills property, tax, owner data + builds a full manifest.
 * Returns the lead ID or null if creation failed.
 */
export async function createEnrichedLeadFromProspect(
  match: ProspectMatch,
  inboundPhone: string,
  source: 'tax_delinquent_inbound_call' | 'tax_delinquent_inbound_sms' | 'website_form' | 'youtube' | 'inbound_ivr' | 'cold_call_callback' | 'inbound_call',
  priority: 'hot' | 'warm',
): Promise<string | null> {
  const supabase = getSupabase()

  // If prospect already linked to a lead, return that
  if (match.lead_id) return match.lead_id

  // Build display name
  const fullName = match.owner_1_first && match.owner_1_last
    ? `${match.owner_1_first} ${match.owner_1_last}`
    : match.owner_1 || `Tax Prospect (${inboundPhone})`

  // Build notes summary
  const noteLines: string[] = [
    `--- Tax Delinquent Prospect ---`,
    `County: ${match.county.charAt(0).toUpperCase() + match.county.slice(1)}`,
    `Parcel: ${match.parcel_id}`,
    `Tax Owed: $${match.cumulative_due?.toLocaleString() || 'N/A'}`,
    `Delinquent Since: ${match.earliest_delinquent_year || 'N/A'}`,
    `Category: ${match.delinquent_years_category === '3yr_plus' ? '3+ years' : '2 years'}`,
  ]
  if (match.total_market_value) noteLines.push(`Market Value: $${match.total_market_value.toLocaleString()}`)
  if (match.zestimate) noteLines.push(`Zestimate: $${match.zestimate.toLocaleString()}`)
  if (match.occupancy_status) noteLines.push(`Occupancy: ${match.occupancy_status}`)
  if (match.is_deceased) noteLines.push(`DECEASED OWNER`)
  if (match.owner_age) noteLines.push(`Owner Age: ${match.owner_age}`)
  if (match.relationship !== 'owner') {
    noteLines.push(`Inbound caller: ${match.contact_name || 'relative'} (${match.relationship})`)
  }

  // Determine city/state/zip from situs
  const city = match.situs_city || undefined
  const state = match.situs_state || undefined
  const zip = match.situs_zip || undefined

  // Insert lead
  const { data: newLead } = await supabase.from('leads').insert({
    full_name: fullName,
    phone: inboundPhone,
    email: match.email_1 || null,
    property_address: match.situs_street || match.situs_address || null,
    city: city || null,
    zip: zip || null,
    county: match.county || null,
    source,
    station: 'new',
    priority,
    notes: noteLines.join('\n'),
  }).select('id').single()

  const leadId = newLead?.id
  if (!leadId) return null

  // Link prospect back to lead
  await supabase.from('prospects')
    .update({ lead_id: leadId })
    .eq('id', match.prospect_id)

  // Build manifest with prospect enrichment
  const firstName = match.owner_1_first || fullName.split(' ')[0] || 'Unknown'
  const lastName = match.owner_1_last || fullName.split(' ').slice(1).join(' ') || undefined

  const manifest = buildManifest({
    firstName,
    lastName,
    phone: inboundPhone,
    email: match.email_1 || undefined,
    propertyAddress: match.situs_street || match.situs_address || undefined,
    source,
    leadId,
    station: 'new',
    priority,
  })

  // Enrich manifest with prospect data
  manifest.lastUpdatedBy = 'system:prospect_import'
  manifest.property.parcel = match.parcel_id

  if (match.cumulative_due) {
    manifest.property.taxCollector = {
      ...manifest.property.taxCollector,
      totalOwed: match.cumulative_due,
      delinquentAmount: match.cumulative_due,
      yearsDelinquent: match.earliest_delinquent_year
        ? new Date().getFullYear() - match.earliest_delinquent_year
        : undefined,
    }
  }

  if (match.total_market_value) {
    manifest.property.assessment = {
      ...manifest.property.assessment,
      totalValue: match.total_market_value,
    }
  }

  if (match.occupancy_status) {
    (manifest.property as any).occupancy = match.occupancy_status
  }

  if (!manifest.financials) manifest.financials = {}
  if (match.zestimate) {
    manifest.financials.arv = match.zestimate
  }
  if (match.cumulative_due) {
    manifest.financials.back_taxes = match.cumulative_due
  }

  manifest.owner.deceased = match.is_deceased || false
  manifest.owner.outOfState = !!(match.mailing_state && match.situs_state &&
    match.mailing_state.toUpperCase() !== match.situs_state.toUpperCase())

  if (match.email_1) manifest.owner.emails = [match.email_1]
  if (match.email_2) manifest.owner.emails = [...(manifest.owner.emails || []), match.email_2]

  // Situation type
  manifest.situation.type = ['tax_delinquent']
  if (match.is_deceased) manifest.situation.type.push('inherited')

  // Opportunity flags
  const flags: string[] = []
  if (match.is_deceased) flags.push('deceased_owner')
  if (match.delinquent_years_category === '3yr_plus') flags.push('3yr_tax_delinquent')
  if (match.occupancy_status?.toLowerCase().includes('absentee')) flags.push('vacant_property')
  if (manifest.owner.outOfState) flags.push('out_of_state_owner')
  manifest.flags.opportunityFlags = flags

  // Motivation signals
  manifest.situation.motivation = {
    ...manifest.situation.motivation,
    signals: ['tax_delinquent_county_list', 'seller_called_in'],
  }

  // Audit trail
  manifest.auditTrail.push({
    timestamp: new Date().toISOString(),
    agent: 'system:prospect_match',
    action: 'enriched_from_prospect',
    details: {
      parcel_id: match.parcel_id,
      county: match.county,
      cumulative_due: match.cumulative_due,
      is_deceased: match.is_deceased,
      delinquent_years_category: match.delinquent_years_category,
      phone_relationship: match.relationship,
    },
  })

  // Insert manifest
  await supabase.from('manifests').insert({
    lead_id: leadId,
    version: 2,
    manifest,
    current_station: 'new',
    priority,
    tier: match.delinquent_years_category === '3yr_plus' && match.is_deceased ? 'S' :
          match.delinquent_years_category === '3yr_plus' ? 'A' : 'B',
  })

  // Fire communication event (async, non-blocking)
  const eventType = source.includes('call') ? 'inbound_call' : 'inbound_sms'
  onCommunicationEvent(leadId, { type: eventType as any }).catch(err => console.error('[MANIFEST] Failed:', err))

  return leadId
}

/**
 * Build a formatted prospect context string for agent alerts.
 */
export function formatProspectAlert(match: ProspectMatch): string {
  const parts: string[] = []

  if (match.situs_street || match.situs_address) {
    parts.push(`Property: ${match.situs_street || match.situs_address}`)
  }
  if (match.cumulative_due) {
    parts.push(`Tax: $${match.cumulative_due.toLocaleString()}`)
  }
  parts.push(`County: ${match.county.charAt(0).toUpperCase() + match.county.slice(1)}`)
  if (match.delinquent_years_category === '3yr_plus') {
    parts.push(`3yr+ delinquent`)
  }
  if (match.is_deceased) {
    parts.push(`DECEASED`)
  }
  if (match.relationship !== 'owner') {
    parts.push(`Caller: ${match.contact_name || 'relative'}`)
  }

  return parts.join(' | ')
}
