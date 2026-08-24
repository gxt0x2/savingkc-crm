import { createClient } from '@supabase/supabase-js'
import type { ProspectMatch } from './prospect-lookup'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * Create an enriched lead from a prospect match.
 * Pre-fills the canonical contact fields and preserves the linked prospect as
 * the source of truth for property, tax, owner, and source-list evidence.
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
    state: state || null,
    zip: zip || null,
    county: match.county || null,
    parcel_id: match.parcel_id || null,
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

  const { error: promotionEvidenceError } = await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'status_change',
    description: `Prospect promoted to a lead from the ${match.county} County tax list.`,
    agent: 'System',
    metadata: {
      source: 'prospect_promotion',
      prospect_id: match.prospect_id,
      parcel_id: match.parcel_id,
      county: match.county,
      cumulative_due: match.cumulative_due,
      earliest_delinquent_year: match.earliest_delinquent_year,
      delinquent_years_category: match.delinquent_years_category,
      is_deceased: match.is_deceased,
      occupancy_status: match.occupancy_status,
      phone_relationship: match.relationship,
    },
  })
  if (promotionEvidenceError) {
    console.error('[prospect-to-lead] Failed to store promotion evidence:', promotionEvidenceError)
  }

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
