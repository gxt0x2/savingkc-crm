/**
 * Automatic county/prospect enrichment for the canonical property linked to a
 * lead. Provider evidence is durable and typed; historical compatibility JSON
 * is neither read nor written here.
 */

import { createClient } from '@supabase/supabase-js'

import {
  CountyEnrichmentService,
  detectCounty,
  parseAddressForCounty,
  type EnrichmentInput,
  type EnrichmentResult,
} from './county-enrichment'
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

/** County-returned housing/assessor facts the lead profile actually displays. */
export function hasCountyPropertyFacts(facts: CanonicalPropertyFacts | null | undefined): boolean {
  if (!facts) return false
  return [
    facts.bedrooms,
    facts.bathrooms,
    facts.sqft,
    facts.assessedValue,
    facts.appraisedValue,
    facts.ownerName,
  ].some((value) => value !== undefined && value !== null && value !== '')
}

function expectedStateForCounty(county?: string | null): 'KS' | 'MO' | null {
  const normalized = county?.toLowerCase().trim()
  if (!normalized) return null
  if (['johnson', 'wyandotte', 'leavenworth', 'miami', 'douglas'].includes(normalized)) return 'KS'
  if (['jackson', 'clay', 'platte'].includes(normalized)) return 'MO'
  return null
}

const SUPPORTED_COUNTIES: Record<'KS' | 'MO', string[]> = {
  KS: ['Johnson', 'Wyandotte'],
  MO: ['Jackson', 'Clay', 'Platte'],
}

export type LocationHint = {
  address?: string
  city?: string
  state?: string
  zip?: string
  county?: string
  parcelId?: string
}

function fillMissing(base: LocationHint, extra: LocationHint): LocationHint {
  return {
    address: base.address || extra.address,
    city: base.city || extra.city,
    state: base.state || extra.state,
    zip: base.zip || extra.zip,
    county: base.county || extra.county,
    parcelId: base.parcelId || extra.parcelId,
  }
}

function hintFromRecord(row: Record<string, unknown>): LocationHint {
  return {
    address: cleanText(row.property_address) || cleanText(row.address) || cleanText(row.situs_street) || cleanText(row.situs_address),
    city: cleanText(row.city) || cleanText(row.situs_city),
    state: cleanText(row.state) || cleanText(row.situs_state),
    zip: cleanText(row.zip) || cleanText(row.situs_zip),
    county: cleanText(row.county),
    parcelId: cleanText(row.parcel_id) || cleanText(row.parcelId),
  }
}

export function streetLineFromAddress(address: string, parsed?: { city?: string; state?: string; zip?: string }): string {
  let street = address.trim()
  const city = parsed?.city?.trim()
  const state = parsed?.state?.trim()
  const zip = parsed?.zip?.trim()
  if (zip) street = street.replace(new RegExp(`[,\\s]+${zip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '')
  if (state) street = street.replace(new RegExp(`[,\\s]+${state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '')
  if (city) street = street.replace(new RegExp(`[,\\s]+${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '')
  return street.replace(/[,\s]+$/, '').trim() || address.trim()
}

/**
 * Resolve county assessor lookup input from a lead plus optional prospect/Mojo/property hints.
 * Address-only Mojo shells (city/state/county blank) still produce a county attempt.
 */
export function resolveCountyAttempts(lead: Record<string, unknown>, hints: LocationHint[] = []): EnrichmentInput[] {
  let location = hintFromRecord(lead)
  for (const hint of hints) location = fillMissing(location, hint)

  const parsed = location.address ? parseAddressForCounty(location.address) : null
  if (parsed) {
    location = fillMissing(location, {
      city: parsed.city,
      state: parsed.state,
      zip: parsed.zip,
      county: parsed.county,
    })
  }

  const detected = detectCounty(location.city, location.state, location.zip)
  location.county = location.county || detected?.county
  location.state = expectedStateForCounty(location.county) || location.state || detected?.state

  const address = location.address
  if (!address) return []

  const street = streetLineFromAddress(address, {
    city: location.city,
    state: location.state,
    zip: location.zip,
  })
  const state = cleanText(location.state)?.toUpperCase()
  const county = cleanText(location.county)
  const base = {
    address: street,
    city: location.city,
    zip: location.zip,
    ...(location.parcelId ? { parcel_id: location.parcelId } : {}),
  }

  if (county && state) {
    return [{ ...base, state, county }]
  }

  const fallbackState = (state === 'KS' || state === 'MO' ? state : null)
    || (parsed?.state === 'KS' || parsed?.state === 'MO' ? parsed.state : null)
  if (!fallbackState) return []

  return SUPPORTED_COUNTIES[fallbackState].map((candidate) => ({
    ...base,
    state: fallbackState,
    county: candidate,
  }))
}

async function linkProspectToLead(match: ProspectMatch, leadId: string): Promise<void> {
  if (match.lead_id === leadId) return
  if (match.lead_id && match.lead_id !== leadId) {
    throw new Error('Prospect is already linked to another lead')
  }
  const { error } = await getSupabase().from('prospects').update({ lead_id: leadId }).eq('id', match.prospect_id)
  if (error) throw new Error(`Prospect link failed: ${error.message}`)
}

function prospectLocationHint(match: ProspectMatch): LocationHint {
  return {
    address: cleanText(match.situs_street) || cleanText(match.situs_address),
    city: cleanText(match.situs_city),
    state: cleanText(match.situs_state),
    zip: cleanText(match.situs_zip),
    county: cleanText(match.county),
    parcelId: cleanText(match.parcel_id),
  }
}

async function enrichFromProspect(leadId: string, phone: string, overwrite: boolean): Promise<{
  matched: boolean
  hint: LocationHint | null
}> {
  const matches = await lookupProspectByPhone(phone)
  if (matches.length === 0) return { matched: false, hint: null }
  const match = matches[0]
  await linkProspectToLead(match, leadId)
  await recordCanonicalPropertyEnrichment({
    leadId,
    source: 'prospect_match',
    sourceReference: match.prospect_id,
    facts: prospectEnrichmentFacts(match),
    overwrite,
  })
  return { matched: true, hint: prospectLocationHint(match) }
}

async function enrichFromCounty(
  leadId: string,
  input: EnrichmentInput,
  overwrite: boolean,
): Promise<CanonicalPropertyFacts | null> {
  const service = new CountyEnrichmentService()
  const result = await service.enrich(input, overwrite)
  if (!result.success) {
    console.warn('[auto-enrich] County enrichment failed for lead', leadId, input.county, result.error)
    return null
  }
  const facts = countyEnrichmentFacts(result, input)
  if (Object.keys(facts).length === 0) return null
  await recordCanonicalPropertyEnrichment({
    leadId,
    source: 'county_assessor',
    sourceReference: result.source || `${input.county}:${input.state}`,
    facts,
    observedAt: result.fetchedAt,
    overwrite,
  })
  return facts
}

async function enrichFromCountyAttempts(
  leadId: string,
  attempts: EnrichmentInput[],
  overwrite: boolean,
): Promise<CanonicalPropertyFacts | null> {
  let lastFacts: CanonicalPropertyFacts | null = null
  for (const input of attempts) {
    const facts = await enrichFromCounty(leadId, input, overwrite)
    if (hasCountyPropertyFacts(facts)) return facts
    if (facts) lastFacts = facts
  }
  return lastFacts
}

async function loadLead(leadId: string) {
  const { data, error } = await getSupabase()
    .from('leads')
    .select('id,phone,property_address,city,state,zip,county,source,is_parked,parcel_id')
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw new Error(`Lead enrichment lookup failed: ${error.message}`)
  return data
}

async function loadLocationHints(leadId: string): Promise<LocationHint[]> {
  const db = getSupabase()
  const hints: LocationHint[] = []

  const { data: link, error: linkError } = await db
    .from('crm_lead_entity_links')
    .select('property_id')
    .eq('lead_id', leadId)
    .maybeSingle()
  if (linkError) throw new Error(`Canonical property lookup failed: ${linkError.message}`)
  if (link?.property_id) {
    const { data: property, error: propertyError } = await db
      .from('crm_properties')
      .select('address,city,state,zip,county,parcel_id,bedrooms,bathrooms,sqft,assessed_value,tax_assessment,property_owner_name')
      .eq('id', link.property_id)
      .maybeSingle()
    if (propertyError) throw new Error(`Canonical property facts lookup failed: ${propertyError.message}`)
    if (property) hints.push(hintFromRecord(property as Record<string, unknown>))
  }

  const { data: prospect, error: prospectError } = await db
    .from('prospects')
    .select('situs_street,situs_address,situs_city,situs_state,situs_zip,county,parcel_id')
    .eq('lead_id', leadId)
    .limit(1)
    .maybeSingle()
  if (prospectError) throw new Error(`Prospect location lookup failed: ${prospectError.message}`)
  if (prospect) hints.push(hintFromRecord(prospect as Record<string, unknown>))

  const { data: mojo, error: mojoError } = await db
    .from('crm_mojo_call_events')
    .select('property_address,city,state,zip')
    .eq('lead_id', leadId)
    .order('call_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (mojoError) throw new Error(`Mojo address lookup failed: ${mojoError.message}`)
  if (mojo) hints.push(hintFromRecord(mojo as Record<string, unknown>))

  return hints
}

function existingCountyFacts(property: Record<string, unknown> | null | undefined): CanonicalPropertyFacts {
  if (!property) return {}
  return compactFacts({
    bedrooms: finiteNumber(property.bedrooms),
    bathrooms: finiteNumber(property.bathrooms),
    sqft: finiteNumber(property.sqft),
    assessedValue: finiteNumber(property.assessed_value),
    appraisedValue: finiteNumber(property.tax_assessment),
    ownerName: cleanText(property.property_owner_name),
  })
}

async function loadExistingCountyFacts(leadId: string): Promise<CanonicalPropertyFacts> {
  const { data: link, error: linkError } = await getSupabase()
    .from('crm_lead_entity_links')
    .select('property_id')
    .eq('lead_id', leadId)
    .maybeSingle()
  if (linkError) throw new Error(`Canonical property lookup failed: ${linkError.message}`)
  if (!link?.property_id) return {}
  const { data: property, error } = await getSupabase()
    .from('crm_properties')
    .select('bedrooms,bathrooms,sqft,assessed_value,tax_assessment,property_owner_name')
    .eq('id', link.property_id)
    .maybeSingle()
  if (error) throw new Error(`Canonical property facts lookup failed: ${error.message}`)
  return existingCountyFacts(property as Record<string, unknown> | null)
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

export type AutoEnrichDependencies = {
  loadLead?: typeof loadLead
  loadLocationHints?: typeof loadLocationHints
  loadExistingCountyFacts?: typeof loadExistingCountyFacts
  completedSources?: typeof completedSources
  enrichFromProspect?: typeof enrichFromProspect
  enrichFromCountyAttempts?: typeof enrichFromCountyAttempts
}

/** Run missing enrichment sources. Infrastructure failures reject for durable retry. */
export async function autoEnrichLead(
  leadId: string,
  dependencies: AutoEnrichDependencies = {},
): Promise<void> {
  const load = dependencies.loadLead || loadLead
  const hintsFor = dependencies.loadLocationHints || loadLocationHints
  const existingFactsFor = dependencies.loadExistingCountyFacts || loadExistingCountyFacts
  const completedFor = dependencies.completedSources || completedSources
  const prospect = dependencies.enrichFromProspect || enrichFromProspect
  const county = dependencies.enrichFromCountyAttempts || enrichFromCountyAttempts

  const lead = await load(leadId)
  if (!lead) return
  // County-prospect imports are already projected by the prospect link trigger.
  if (lead.is_parked === true || (typeof lead.source === 'string' && lead.source.startsWith('tax_delinquent_'))) return

  const completed = await completedFor(leadId)
  const existingFacts = await existingFactsFor(leadId)
  const hints = await hintsFor(leadId)
  const phone = cleanText(lead.phone)

  let prospectHint: LocationHint | null = null
  if (phone && !completed.has('prospect_match')) {
    const result = await prospect(leadId, phone, false)
    prospectHint = result.hint
  }

  const attempts = resolveCountyAttempts(lead as Record<string, unknown>, [
    ...hints,
    ...(prospectHint ? [prospectHint] : []),
  ])
  const needsCounty = attempts.length > 0 && !hasCountyPropertyFacts(existingFacts)
  const countyFacts = needsCounty ? await county(leadId, attempts, false) : null

  if (needsCounty && !hasCountyPropertyFacts(countyFacts)) {
    throw new Error('County assessor did not return property details')
  }
}

/** Force both available providers and overwrite only the typed facts they return. */
export async function forceReenrichLead(
  leadId: string,
  dependencies: AutoEnrichDependencies = {},
): Promise<{
  success: boolean
  prospectMatch: boolean
  countyEnriched: boolean
  error?: string
}> {
  const load = dependencies.loadLead || loadLead
  const hintsFor = dependencies.loadLocationHints || loadLocationHints
  const prospect = dependencies.enrichFromProspect || enrichFromProspect
  const county = dependencies.enrichFromCountyAttempts || enrichFromCountyAttempts

  try {
    const lead = await load(leadId)
    if (!lead) return { success: false, prospectMatch: false, countyEnriched: false, error: 'Lead not found' }
    const phone = cleanText(lead.phone)
    const hints = await hintsFor(leadId)
    const prospectResult = phone ? await prospect(leadId, phone, true) : { matched: false, hint: null }
    const attempts = resolveCountyAttempts(lead as Record<string, unknown>, [
      ...hints,
      ...(prospectResult.hint ? [prospectResult.hint] : []),
    ])
    const countyFacts = attempts.length > 0 ? await county(leadId, attempts, true) : null
    const countyEnriched = hasCountyPropertyFacts(countyFacts)
    if (attempts.length > 0 && !countyEnriched) {
      return {
        success: false,
        prospectMatch: prospectResult.matched,
        countyEnriched: false,
        error: 'County assessor did not return property details',
      }
    }
    return { success: true, prospectMatch: prospectResult.matched, countyEnriched }
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
