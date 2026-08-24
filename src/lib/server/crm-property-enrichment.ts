import { supabaseAdmin } from '@/lib/supabase/admin'

export type CanonicalPropertyFacts = Partial<{
  parcelId: string
  county: string
  propertyType: string
  bedrooms: number
  bathrooms: number
  sqft: number
  yearBuilt: number
  lotSize: number
  basementType: string
  garageSpaces: number
  roofType: string
  heating: string
  appraisedValue: number
  assessedValue: number
  landValue: number
  improvementValue: number
  taxOwed: number
  taxStatus: string
  ownerName: string
  mailingAddress: string
  firstDelinquentYear: number
  zestimate: number
  totalMarketValue: number
  occupancyStatus: string
  ownerIsDeceased: boolean
  ownerIsOutOfState: boolean
}>

type Db = ReturnType<typeof supabaseAdmin>

export async function recordCanonicalPropertyEnrichment(input: {
  leadId: string
  source: 'prospect_match' | 'county_assessor'
  sourceReference?: string | null
  facts: CanonicalPropertyFacts
  observedAt?: string | null
  overwrite?: boolean
}, db: Db = supabaseAdmin()): Promise<{ propertyId: string; eventId: string }> {
  const { data, error } = await db.rpc('record_crm_property_enrichment_v1', {
    p_lead_id: input.leadId,
    p_source: input.source,
    p_source_reference: input.sourceReference ?? null,
    p_facts: input.facts,
    p_observed_at: input.observedAt ?? new Date().toISOString(),
    p_overwrite: input.overwrite ?? false,
  })
  if (error) throw new Error(`Canonical property enrichment failed: ${error.message}`)
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || typeof data.propertyId !== 'string' || typeof data.eventId !== 'string') {
    throw new Error('Canonical property enrichment returned an invalid result')
  }
  return { propertyId: data.propertyId, eventId: data.eventId }
}
