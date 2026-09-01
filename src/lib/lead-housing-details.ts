import type { PropertyHousingDetails } from '@/components/leads/property-details-card'

export function pickValue<T>(a: T | null | undefined, b: T | null | undefined): T | null {
  return a !== null && a !== undefined ? a : (b !== null && b !== undefined ? b : null)
}

export function splitCanonicalBaths(
  canonical: { bathroomsFull?: number | null; bathroomsHalf?: number | null; bathrooms?: number | null } | null,
  lead: { baths_full: number | null; baths_half: number | null },
): { baths_full: number | null; baths_half: number | null } {
  const full = pickValue(canonical?.bathroomsFull, lead.baths_full)
  const half = pickValue(canonical?.bathroomsHalf, lead.baths_half)
  if (full != null || half != null) return { baths_full: full, baths_half: half }
  const combined = canonical?.bathrooms
  if (typeof combined === 'number' && Number.isFinite(combined) && combined >= 0) {
    const whole = Math.floor(combined)
    const extraHalves = Math.round((combined - whole) * 2)
    return { baths_full: whole || null, baths_half: extraHalves || null }
  }
  return { baths_full: null, baths_half: null }
}

export type HousingLead = {
  beds: number | null
  baths_full: number | null
  baths_half: number | null
  sqft: number | null
  lot_size: number | null
  year_built: number | null
  basement_type: string | null
  stories: number | null
  garage_spaces: number | null
  roof_type: string | null
  heating: string | null
  cooling: string | null
  property_type: string | null
  zoning: string | null
  hoa_amount: number | null
  tax_assessment: number | null
  last_sale_date: string | null
  last_sale_price: number | null
  data_source: string | null
  data_enriched_at: string | null
}

type HousingProperty = {
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
  propertyType?: string | null
  zoning?: string | null
  hoaAmount?: number | null
  taxAssessment?: number | null
  taxOwed?: number | null
  firstDelinquentYear?: number | null
  lastSaleDate?: string | null
  lastSalePrice?: number | null
  dataSource?: string | null
  dataEnrichedAt?: string | null
}

export function leadHousingDetails(
  canonical: HousingProperty | null,
  lead: HousingLead,
): PropertyHousingDetails {
  const baths = splitCanonicalBaths(canonical, lead)
  return {
    beds: pickValue(canonical?.bedrooms, lead.beds),
    baths_full: baths.baths_full,
    baths_half: baths.baths_half,
    sqft: pickValue(canonical?.sqft, lead.sqft),
    lot_size: pickValue(canonical?.lotSize, lead.lot_size),
    year_built: pickValue(canonical?.yearBuilt, lead.year_built),
    basement_type: pickValue(canonical?.basementType, lead.basement_type),
    stories: pickValue(canonical?.stories, lead.stories),
    garage_spaces: pickValue(canonical?.garageSpaces, lead.garage_spaces),
    roof_type: pickValue(canonical?.roofType, lead.roof_type),
    heating: pickValue(canonical?.heating, lead.heating),
    cooling: pickValue(canonical?.cooling, lead.cooling),
    property_type: pickValue(canonical?.propertyType, lead.property_type),
    zoning: pickValue(canonical?.zoning, lead.zoning),
    hoa_amount: pickValue(canonical?.hoaAmount, lead.hoa_amount),
    tax_assessment: pickValue(canonical?.taxAssessment, lead.tax_assessment),
    tax_owed: canonical?.taxOwed ?? null,
    first_delinquent_year: canonical?.firstDelinquentYear ?? null,
    last_sale_date: pickValue(canonical?.lastSaleDate, lead.last_sale_date),
    last_sale_price: pickValue(canonical?.lastSalePrice, lead.last_sale_price),
    data_source: pickValue(canonical?.dataSource, lead.data_source),
    data_enriched_at: pickValue(canonical?.dataEnrichedAt, lead.data_enriched_at),
  }
}

/**
 * Builds a read-only presentation aggregate for profile surfaces. Canonical
 * property facts win, while the compatibility lead remains the fallback. This
 * does not copy enrichment data back onto the lead record.
 */
export function applyCanonicalHousingToLead<T extends HousingLead>(
  lead: T,
  canonical: HousingProperty | null,
): T & PropertyHousingDetails {
  return {
    ...lead,
    ...leadHousingDetails(canonical, lead),
  }
}
