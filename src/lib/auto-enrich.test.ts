import fs from 'node:fs'

import { describe, expect, it } from 'vitest'

import { countyEnrichmentFacts, prospectEnrichmentFacts } from './auto-enrich'
import type { ProspectMatch } from './prospect-lookup'

const prospect: ProspectMatch = {
  prospect_id: 'prospect-1', parcel_id: 'parcel-1', county: 'Jackson',
  situs_address: '100 Main', situs_street: '100 Main', situs_city: 'Kansas City', situs_state: 'MO', situs_zip: '64101',
  owner_1: 'Seller Name', owner_1_first: 'Seller', owner_1_last: 'Name', owner_1_type: null,
  mailing_street: '200 Oak', mailing_city: 'Overland Park', mailing_state: 'KS', mailing_zip: '66204',
  cumulative_due: 3450, earliest_delinquent_year: 2023, delinquent_years_category: '3yr_plus',
  total_market_value: 185000, zestimate: 205000, occupancy_status: 'absentee', is_deceased: true,
  is_skip_traced: true, owner_age: 78, email_1: null, email_2: null, lead_id: null,
  phone_type: 'mobile', contact_name: 'Seller Name', relationship: 'owner',
}

describe('canonical automatic enrichment', () => {
  it('maps prospect evidence without inventing seller or property facts', () => {
    expect(prospectEnrichmentFacts(prospect)).toEqual({
      parcelId: 'parcel-1', county: 'Jackson', taxOwed: 3450, taxStatus: 'delinquent',
      firstDelinquentYear: 2023, zestimate: 205000, totalMarketValue: 185000,
      occupancyStatus: 'absentee', ownerName: 'Seller Name',
      mailingAddress: '200 Oak, Overland Park, KS, 66204',
      ownerIsDeceased: true, ownerIsOutOfState: true,
    })
  })

  it('maps county evidence and preserves zero tax owed', () => {
    expect(countyEnrichmentFacts({
      success: true, county: 'Johnson', parcelId: 'p-2', appraisedValue: 210000,
      assessedValue: 24500, taxOwed: 0, taxStatus: 'current', yearBuilt: 1985,
      sqft: 1550, bedrooms: 3, bathrooms: 2, propertyType: 'Residential',
      ownerName: 'Owner', mailingAddress: 'PO Box 1, Kansas City, MO 64106',
      rawData: { garageSize: '2', basementDesc: 'Full', roofType: 'Composition', hvac: 'Central' },
    }, { county: 'Johnson', state: 'KS' })).toMatchObject({
      parcelId: 'p-2', county: 'Johnson', appraisedValue: 210000, assessedValue: 24500,
      taxOwed: 0, yearBuilt: 1985, sqft: 1550, garageSpaces: 2,
      basementType: 'Full', ownerIsOutOfState: true,
    })
  })

  it('contains no operational Manifest dependency in automatic or batch enrichment', () => {
    const automatic = fs.readFileSync('src/lib/auto-enrich.ts', 'utf8')
    const direct = fs.readFileSync('src/app/api/enrich/route.ts', 'utf8')
    const batch = fs.readFileSync('src/app/api/enrich/batch/route.ts', 'utf8')
    expect(automatic).not.toMatch(/manifest-sync|from\(['"]manifests|updateManifest/i)
    expect(direct).not.toMatch(/manifest-sync|from\(['"]manifests|updateManifest/i)
    expect(batch).not.toMatch(/manifest-sync|from\(['"]manifests|updateManifest/i)
  })
})
