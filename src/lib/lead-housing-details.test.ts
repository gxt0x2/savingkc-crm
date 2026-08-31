import { describe, expect, it } from 'vitest'

import { applyCanonicalHousingToLead, leadHousingDetails, splitCanonicalBaths } from './lead-housing-details'

describe('canonical housing details', () => {
  it('splits combined county bathrooms onto the full/half tiles', () => {
    expect(splitCanonicalBaths({ bathrooms: 3.5 }, { baths_full: null, baths_half: null })).toEqual({
      baths_full: 3,
      baths_half: 1,
    })
  })

  it('prefers explicit full/half facts over a combined bathrooms value', () => {
    expect(splitCanonicalBaths(
      { bathrooms: 3.5, bathroomsFull: 3, bathroomsHalf: 1 },
      { baths_full: 2, baths_half: 0 },
    )).toEqual({ baths_full: 3, baths_half: 1 })
  })

  it('surfaces county housing facts on the lead profile even when the lead row is blank', () => {
    expect(leadHousingDetails({
      bedrooms: 4,
      bathrooms: 3.5,
      sqft: 2085,
      taxAssessment: 500200,
      taxOwed: 24295.68,
      firstDelinquentYear: 2023,
      dataSource: 'county_assessor',
      dataEnrichedAt: '2026-08-27T00:00:00.000Z',
    }, {
      beds: null, baths_full: null, baths_half: null, sqft: null, lot_size: null, year_built: null,
      basement_type: null, stories: null, garage_spaces: null, roof_type: null, heating: null, cooling: null,
      property_type: null, zoning: null, hoa_amount: null, tax_assessment: null, last_sale_date: null,
      last_sale_price: null, data_source: 'prospect_match', data_enriched_at: '2026-08-26T00:00:00.000Z',
    })).toMatchObject({
      beds: 4,
      baths_full: 3,
      baths_half: 1,
      sqft: 2085,
      tax_assessment: 500200,
      tax_owed: 24295.68,
      data_source: 'county_assessor',
    })
  })

  it('builds the profile presentation from canonical facts without mutating the lead row', () => {
    const lead = {
      beds: null, baths_full: null, baths_half: null, sqft: null, lot_size: null, year_built: null,
      basement_type: null, stories: null, garage_spaces: null, roof_type: null, heating: null, cooling: null,
      property_type: null, zoning: null, hoa_amount: null, tax_assessment: null, last_sale_date: null,
      last_sale_price: null, data_source: null, data_enriched_at: null,
    }

    const presented = applyCanonicalHousingToLead(lead, {
      bedrooms: 3,
      bathrooms: 1,
      sqft: 2116,
      yearBuilt: 1880,
      propertyType: 'SF RESIDENCE',
      taxAssessment: 64800,
      dataSource: 'county_assessor',
    })

    expect(presented).toMatchObject({
      beds: 3,
      baths_full: 1,
      baths_half: null,
      sqft: 2116,
      year_built: 1880,
      property_type: 'SF RESIDENCE',
      tax_assessment: 64800,
      data_source: 'county_assessor',
    })
    expect(lead).toMatchObject({
      beds: null,
      baths_full: null,
      sqft: null,
      year_built: null,
    })
  })
})
