/**
 * Automatic county/prospect enrichment for the canonical property linked to a
 * lead. Provider evidence is durable and typed; historical compatibility JSON
 * is neither read nor written here.
 */

import { createClient } from '@supabase/supabase-js'

import { CountyEnrichmentService, type EnrichmentResult } from './county-enrichment'
import { detectCounty } from './county-enrichment'
import { lookupProspectByPhone, type ProspectMatch } from './prospect-lookup'
import { getSupabaseAdminKey, getSupabaseUrl } from './supabase/env'
import {
  recordCanonicalPropertyEnrichment,
  type CanonicalPropertyFacts,
} from './server/crm-property-enrichment'

function getSupabase() {
  return createClient(
    getSupabaseUrl(),
    getSupabaseAdminKey(),
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function cleanText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function compactFacts(facts: CanonicalPropertyFacts): CanonicalPropertyFacts {
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== null && value !== undefined && value !== '')) as CanonicalPropertyFacts
}

function mailingAddress(match: ProspectMatch): string | undefined {
  return cleanText([match.mailing_street, match.mailing_city, match.mailing_state, match.mailing_zip]
    .filter(Boolean).join(', '))
}

export function prospectEnrichmentFacts(match: ProspectMatch): CanonicalPropertyFacts {
  const statesKnown = Boolean(cleanText(match.mailing_state) && cleanText(match.situs_state))
  return compactFacts({
    parcelId: cleanText(match.parcel_id),
    county: cleanText(match.county),
    taxOwed: finiteNumber(match.cumulative_due),
    taxStatus: typeof match.cumulative_due === 'number' && match.cumulative_due > 0 ? 'delinquent' : undefined,
    firstDelinquentYear: finiteNumber(match.earliest_delinquent_year),
    zestimate: finiteNumber(match.zestimate),
    totalMarketValue: finiteNumber(match.total_market_value),
    occupancyStatus: cleanText(match.occupancy_status),
    ownerName: cleanText(match.owner_1),
    mailingAddress: mailingAddress(match),
    ownerIsDeceased: match.is_deceased,
    ownerIsOutOfState: statesKnown
      ? match.mailing_state!.trim().toUpperCase() !== match.situs_state!.trim().toUpperCase()
      : undefined,
  })
}

function mailingState(value: string | undefined): string | null {
  const match = value?.match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/i)
  return match?.[1]?.toUpperCase() || null
}

export function countyEnrichmentFacts(
  result: EnrichmentResult,
  input: { state: string; county: string },
): CanonicalPropertyFacts {
  const ownerMailingState = mailingState(result.mailingAddress)
  const garageSpaces = finiteNumber(result.rawData?.garageSize)
  const ownerOutOfState = ownerMailingState
    ? ownerMailingState !== input.state.trim().toUpperCase()
    : result.rawData?.outOfState === true ? true : undefined

  return compactFacts({
    parcelId: cleanText(result.parcelId),
    county: cleanText(result.county || input.county),
    propertyType: cleanText(result.propertyType),
    bedrooms: finiteNumber(result.bedrooms),
    bathrooms: finiteNumber(result.bathrooms),
    sqft: finiteNumber(result.sqft),
    yearBuilt: finiteNumber(result.yearBuilt),
    lotSize: finiteNumber(result.rawData?.lotSizeSqft ?? result.rawData?.lotSize),
    basementType: cleanText(result.basementType ?? result.rawData?.basementDesc),
    garageSpaces,
    roofType: cleanText(result.rawData?.roofType),
    heating: cleanText(result.rawData?.hvac),
    appraisedValue: finiteNumber(result.appraisedValue),
    assessedValue: finiteNumber(result.assessedValue),
    landValue: finiteNumber(result.landValue),
    improvementValue: finiteNumber(result.improvementValue),
    taxOwed: finiteNumber(result.taxOwed),
    taxStatus: cleanText(result.taxStatus),
    ownerName: cleanText(result.ownerName),
    mailingAddress: cleanText(result.mailingAddress),
    ownerIsOutOfState: ownerOutOfState,
  })
}

function expectedStateForCounty(county?: string | null): 'KS' | 'MO' | null {
  const normalized = county?.toLowerCase().trim()
  if (!normalized) return null
  if (['johnson', 'wyandotte', 'leavenworth', 'miami', 'douglas'].includes(normalized)) return 'KS'
  if (['jackson', 'clay', 'platte'].includes(normalized)) return 'MO'
  return null
}

async function linkProspectToLead(match: ProspectMatch, leadId: string): Promise<void> {
  if (match.lead_id === leadId) return
  if (match.lead_id && match.lead_id !== leadId) {
    throw new Error('Prospect is already linked to another lead')
  }
  const { error } = await getSupabase().from('prospects').update({ lead_id: leadId }).eq('id', match.prospect_id)
  if (error) throw new Error(`Prospect link failed: ${error.message}`)
}

async function enrichFromProspect(leadId: string, phone: string, overwrite: boolean): Promise<boolean> {
  const matches = await lookupProspectByPhone(phone)
  if (matches.length === 0) return false
  const match = matches[0]
  await linkProspectToLead(match, leadId)
  await recordCanonicalPropertyEnrichment({
    leadId,
    source: 'prospect_match',
    sourceReference: match.prospect_id,
    facts: prospectEnrichmentFacts(match),
    overwrite,
  })
  return true
}

async function enrichFromCounty(
  leadId: string,
  input: { address: string; city?: string; state: string; zip?: string; county: string },
  overwrite: boolean,
): Promise<boolean> {
  const service = new CountyEnrichmentService()
  const result = await service.enrich(input, overwrite)
  if (!result.success) {
    console.warn('[auto-enrich] County enrichment failed for lead', leadId, result.error)
    return false
  }
  await recordCanonicalPropertyEnrichment({
    leadId,
    source: 'county_assessor',
    sourceReference: result.source || `${input.county}:${input.state}`,
    facts: countyEnrichmentFacts(result, input),
    observedAt: result.fetchedAt,
    overwrite,
  })
  return true
}

async function loadLead(leadId: string) {
  const { data, error } = await getSupabase()
    .from('leads')
    .select('id,phone,property_address,city,state,zip,county,source')
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw new Error(`Lead enrichment lookup failed: ${error.message}`)
  return data
}

function countyInput(lead: Record<string, unknown>): { address: string; city?: string; state: string; zip?: string; county: string } | null {
  const address = cleanText(lead.property_address)
  if (!address) return null
  const city = cleanText(lead.city)
  let state = cleanText(lead.state)
  const zip = cleanText(lead.zip)
  let county = cleanText(lead.county)

  if (!county || !state) {
    // Kept lazy so an address-only lead does not load county parsing until needed.
    const detected = detectCounty(city, state, zip)
    county = county || detected?.county
    state = expectedStateForCounty(county) || state || detected?.state
  } else {
    state = expectedStateForCounty(county) || state
  }
  if (!county || !state) return null
  return { address, city, state, zip, county }
}

async function completedSources(leadId: string): Promise<Set<string>> {
  const { data, error } = await getSupabase()
    .from('crm_property_enrichment_events')
    .select('source')
    .eq('lead_id', leadId)
    .in('source', ['prospect_match', 'county_assessor'])
    .limit(10)
  if (error) throw new Error(`Enrichment provenance lookup failed: ${error.message}`)
  return new Set((data || []).map((row) => row.source))
}

/** Run missing enrichment sources after lead creation without blocking intake. */
export async function autoEnrichLead(leadId: string): Promise<void> {
  try {
    const lead = await loadLead(leadId)
    if (!lead) return
    // County-prospect imports are already projected by the prospect link trigger.
    if (typeof lead.source === 'string' && lead.source.startsWith('tax_delinquent_')) return

    const completed = await completedSources(leadId)
    const jobs: Promise<boolean>[] = []
    const phone = cleanText(lead.phone)
    if (phone && !completed.has('prospect_match')) jobs.push(enrichFromProspect(leadId, phone, false))
    const propertyInput = countyInput(lead)
    if (propertyInput && !completed.has('county_assessor')) jobs.push(enrichFromCounty(leadId, propertyInput, false))

    const results = await Promise.allSettled(jobs)
    for (const result of results) {
      if (result.status === 'rejected') console.error('[auto-enrich] Source failed for lead', leadId, result.reason)
    }
  } catch (error) {
    console.error('[auto-enrich] Failed for lead', leadId, error)
  }
}

/** Force both available providers and overwrite only the typed facts they return. */
export async function forceReenrichLead(leadId: string): Promise<{
  success: boolean
  prospectMatch: boolean
  countyEnriched: boolean
  error?: string
}> {
  try {
    const lead = await loadLead(leadId)
    if (!lead) return { success: false, prospectMatch: false, countyEnriched: false, error: 'Lead not found' }
    const phone = cleanText(lead.phone)
    const propertyInput = countyInput(lead)
    const prospectMatch = phone ? await enrichFromProspect(leadId, phone, true) : false
    const countyEnriched = propertyInput ? await enrichFromCounty(leadId, propertyInput, true) : false
    return { success: true, prospectMatch, countyEnriched }
  } catch (error) {
    console.error('[force-reenrich] Failed for lead', leadId, error)
    return {
      success: false,
      prospectMatch: false,
      countyEnriched: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
