import { supabaseAdmin } from '@/lib/supabase/admin'

type QueryError = { code?: string | null; message?: string | null }

export interface CrmEntityContext {
  available: boolean
  linked: boolean
  degraded: boolean
  projectedAt: string | null
  person: {
    id: string
    displayName: string
    recordStatus: string
  } | null
  contactMethods: Array<{
    id: string
    type: 'phone' | 'email'
    value: string
    normalizedValue: string
    isPrimary: boolean
    deliverabilityStatus: string
    smsConsentStatus: string
  }>
  property: {
    id: string
    address: string
    city: string | null
    state: string | null
    zip: string | null
    county?: string | null
    parcelId: string | null
    propertyType?: string | null
    bedrooms?: number | null
    bathrooms?: number | null
    bathroomsFull?: number | null
    bathroomsHalf?: number | null
    sqft?: number | null
    lotSize?: number | null
    yearBuilt?: number | null
    basementType?: string | null
    stories?: number | null
    garageSpaces?: number | null
    roofType?: string | null
    heating?: string | null
    cooling?: string | null
    zoning?: string | null
    hoaAmount?: number | null
    taxAssessment?: number | null
    assessedValue?: number | null
    landValue?: number | null
    improvementValue?: number | null
    taxOwed?: number | null
    taxStatus?: string | null
    firstDelinquentYear?: number | null
    lastSaleDate?: string | null
    lastSalePrice?: number | null
    zestimate?: number | null
    redfinEstimate?: number | null
    totalMarketValue?: number | null
    occupancyStatus?: string | null
    propertyOwnerName?: string | null
    ownerMailingAddress?: string | null
    ownerIsDeceased?: boolean | null
    ownerIsOutOfState?: boolean | null
    dataSource?: string | null
    dataEnrichedAt?: string | null
  } | null
  opportunity: {
    id: string
    stage: string
    classification: string | null
    priority: string | null
    ownerName: string | null
    source?: string | null
    lifecycleStatus: string
  } | null
  openIdentityConflicts: number
}

export interface CrmEntityHealth {
  available: boolean
  source: 'canonical_projection' | 'migration_pending'
  leads: number
  linkedLeads: number
  people: number
  contactMethods: number
  properties: number
  opportunities: number
  openIdentityConflicts: number
  consentEvents: number
  projectionCoverage: number
}

export type CrmEntityAuthority = 'canonical_entities' | 'lead_compatibility'

type CompatibilityLeadProfile = Record<string, unknown> & {
  full_name?: string | null
  phone?: string | null
  email?: string | null
  property_address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  county?: string | null
  source?: string | null
  station?: string | null
  classification?: string | null
  priority?: string | null
  assigned_agent?: string | null
}

/**
 * Makes the normalized entity projection authoritative for the contact-workspace
 * fields it owns. The compatibility lead remains an explicit fallback while the
 * wider Manifest/lead cutover is still in progress.
 */
export function applyCrmEntityAuthority<T extends CompatibilityLeadProfile>(
  lead: T,
  context: CrmEntityContext,
): T & { entityAuthority: CrmEntityAuthority } {
  if (!context.available || !context.linked || context.degraded || !context.person || !context.opportunity) {
    return { ...lead, entityAuthority: 'lead_compatibility' }
  }

  const primaryPhone = context.contactMethods.find((method) => method.type === 'phone' && method.isPrimary)
    ?? context.contactMethods.find((method) => method.type === 'phone')
  const primaryEmail = context.contactMethods.find((method) => method.type === 'email' && method.isPrimary)
    ?? context.contactMethods.find((method) => method.type === 'email')

  return {
    ...lead,
    full_name: context.person.displayName,
    phone: primaryPhone?.value ?? lead.phone ?? null,
    email: primaryEmail?.value ?? lead.email ?? null,
    property_address: context.property?.address ?? lead.property_address ?? null,
    city: context.property?.city ?? lead.city ?? null,
    state: context.property?.state ?? lead.state ?? null,
    zip: context.property?.zip ?? lead.zip ?? null,
    county: context.property?.county ?? lead.county ?? null,
    source: context.opportunity.source ?? lead.source ?? null,
    station: context.opportunity.stage,
    classification: context.opportunity.classification,
    priority: context.opportunity.priority,
    assigned_agent: context.opportunity.ownerName,
    entityAuthority: 'canonical_entities',
  }
}

function unavailableContext(): CrmEntityContext {
  return {
    available: false,
    linked: false,
    degraded: true,
    projectedAt: null,
    person: null,
    contactMethods: [],
    property: null,
    opportunity: null,
    openIdentityConflicts: 0,
  }
}

export function isEntityFoundationUnavailable(error: QueryError | null | undefined): boolean {
  const message = error?.message?.toLowerCase() ?? ''
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || message.includes('crm_lead_entity_links') && (
      message.includes('does not exist') || message.includes('schema cache')
    )
}

function requireNoError(error: QueryError | null, label: string): void {
  if (error) throw new Error(`${label}: ${error.message || error.code || 'query failed'}`)
}

export async function readLeadEntityContext(leadId: string): Promise<CrmEntityContext> {
  const db = supabaseAdmin()
  const { data: linkData, error: linkError } = await db
    .from('crm_lead_entity_links')
    .select('person_id, property_id, opportunity_id, projected_at')
    .eq('lead_id', leadId)
    .maybeSingle()

  if (isEntityFoundationUnavailable(linkError)) return unavailableContext()
  requireNoError(linkError, 'CRM entity link lookup failed')
  if (!linkData) {
    return { ...unavailableContext(), available: true, degraded: true }
  }

  const [personResult, methodResult, propertyResult, opportunityResult, conflictResult] = await Promise.all([
    db.from('crm_people')
      .select('id, display_name, record_status')
      .eq('id', linkData.person_id)
      .maybeSingle(),
    db.from('crm_contact_methods')
      .select('id, method_type, raw_value, normalized_value, is_primary, deliverability_status, sms_consent_status')
      .eq('person_id', linkData.person_id)
      .order('method_type')
      .order('is_primary', { ascending: false }),
    linkData.property_id
      ? db.from('crm_properties')
        .select('id, address, city, state, zip, county, parcel_id, property_type, bedrooms, bathrooms, bathrooms_full, bathrooms_half, sqft, lot_size, year_built, basement_type, stories, garage_spaces, roof_type, heating, cooling, zoning, hoa_amount, tax_assessment, assessed_value, land_value, improvement_value, tax_owed, tax_status, first_delinquent_year, last_sale_date, last_sale_price, zestimate, redfin_estimate, total_market_value, occupancy_status, property_owner_name, owner_mailing_address, owner_is_deceased, owner_is_out_of_state, data_source, data_enriched_at')
        .eq('id', linkData.property_id)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from('crm_opportunities')
      .select('id, stage, classification, priority, owner_name, source, lifecycle_status')
      .eq('id', linkData.opportunity_id)
      .maybeSingle(),
    db.from('crm_identity_conflicts')
      .select('id', { count: 'exact', head: true })
      .eq('lead_id', leadId)
      .eq('status', 'open'),
  ])

  requireNoError(personResult.error, 'CRM person lookup failed')
  requireNoError(methodResult.error, 'CRM contact method lookup failed')
  requireNoError(propertyResult.error, 'CRM property lookup failed')
  requireNoError(opportunityResult.error, 'CRM opportunity lookup failed')
  requireNoError(conflictResult.error, 'CRM identity conflict lookup failed')

  const person = personResult.data
  const property = propertyResult.data
  const opportunity = opportunityResult.data

  return {
    available: true,
    linked: Boolean(person && opportunity),
    degraded: !person || !opportunity,
    projectedAt: linkData.projected_at ?? null,
    person: person ? {
      id: person.id,
      displayName: person.display_name,
      recordStatus: person.record_status,
    } : null,
    contactMethods: (methodResult.data ?? []).map((method) => ({
      id: method.id,
      type: method.method_type as 'phone' | 'email',
      value: method.raw_value,
      normalizedValue: method.normalized_value,
      isPrimary: method.is_primary,
      deliverabilityStatus: method.deliverability_status,
      smsConsentStatus: method.sms_consent_status,
    })),
    property: property ? {
      id: property.id,
      address: property.address,
      city: property.city,
      state: property.state,
      zip: property.zip,
      county: property.county,
      parcelId: property.parcel_id,
      propertyType: property.property_type,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      bathroomsFull: property.bathrooms_full,
      bathroomsHalf: property.bathrooms_half,
      sqft: property.sqft,
      lotSize: property.lot_size,
      yearBuilt: property.year_built,
      basementType: property.basement_type,
      stories: property.stories,
      garageSpaces: property.garage_spaces,
      roofType: property.roof_type,
      heating: property.heating,
      cooling: property.cooling,
      zoning: property.zoning,
      hoaAmount: property.hoa_amount,
      taxAssessment: property.tax_assessment,
      assessedValue: property.assessed_value,
      landValue: property.land_value,
      improvementValue: property.improvement_value,
      taxOwed: property.tax_owed,
      taxStatus: property.tax_status,
      firstDelinquentYear: property.first_delinquent_year,
      lastSaleDate: property.last_sale_date,
      lastSalePrice: property.last_sale_price,
      zestimate: property.zestimate,
      redfinEstimate: property.redfin_estimate,
      totalMarketValue: property.total_market_value,
      occupancyStatus: property.occupancy_status,
      propertyOwnerName: property.property_owner_name,
      ownerMailingAddress: property.owner_mailing_address,
      ownerIsDeceased: property.owner_is_deceased,
      ownerIsOutOfState: property.owner_is_out_of_state,
      dataSource: property.data_source,
      dataEnrichedAt: property.data_enriched_at,
    } : null,
    opportunity: opportunity ? {
      id: opportunity.id,
      stage: opportunity.stage,
      classification: opportunity.classification,
      priority: opportunity.priority,
      ownerName: opportunity.owner_name,
      source: opportunity.source,
      lifecycleStatus: opportunity.lifecycle_status,
    } : null,
    openIdentityConflicts: conflictResult.count ?? 0,
  }
}

export async function safeReadLeadEntityContext(leadId: string): Promise<CrmEntityContext> {
  try {
    return await readLeadEntityContext(leadId)
  } catch (error) {
    console.error('CRM entity context is degraded', {
      leadId,
      error: error instanceof Error ? error.message : String(error),
    })
    return unavailableContext()
  }
}

export async function readCrmEntityHealth(): Promise<CrmEntityHealth> {
  const db = supabaseAdmin()
  const [leadResult, linkResult, peopleResult, methodResult, propertyResult, opportunityResult, conflictResult, consentResult] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }),
    db.from('crm_lead_entity_links').select('lead_id', { count: 'exact', head: true }),
    db.from('crm_people').select('id', { count: 'exact', head: true }),
    db.from('crm_contact_methods').select('id', { count: 'exact', head: true }),
    db.from('crm_properties').select('id', { count: 'exact', head: true }),
    db.from('crm_opportunities').select('id', { count: 'exact', head: true }),
    db.from('crm_identity_conflicts').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    db.from('crm_consent_events').select('id', { count: 'exact', head: true }),
  ])

  if (isEntityFoundationUnavailable(linkResult.error)) {
    return {
      available: false,
      source: 'migration_pending',
      leads: leadResult.count ?? 0,
      linkedLeads: 0,
      people: 0,
      contactMethods: 0,
      properties: 0,
      opportunities: 0,
      openIdentityConflicts: 0,
      consentEvents: 0,
      projectionCoverage: 0,
    }
  }

  for (const [label, result] of [
    ['leads', leadResult],
    ['links', linkResult],
    ['people', peopleResult],
    ['contact methods', methodResult],
    ['properties', propertyResult],
    ['opportunities', opportunityResult],
    ['identity conflicts', conflictResult],
    ['consent events', consentResult],
  ] as const) requireNoError(result.error, `CRM entity health ${label} failed`)

  const leads = leadResult.count ?? 0
  const linkedLeads = linkResult.count ?? 0
  return {
    available: true,
    source: 'canonical_projection',
    leads,
    linkedLeads,
    people: peopleResult.count ?? 0,
    contactMethods: methodResult.count ?? 0,
    properties: propertyResult.count ?? 0,
    opportunities: opportunityResult.count ?? 0,
    openIdentityConflicts: conflictResult.count ?? 0,
    consentEvents: consentResult.count ?? 0,
    projectionCoverage: leads === 0 ? 1 : linkedLeads / leads,
  }
}
