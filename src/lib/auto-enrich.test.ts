import fs from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import {
  autoEnrichLead,
  countyEnrichmentFacts,
  forceReenrichLead,
  hasCountyPropertyFacts,
  prospectEnrichmentFacts,
  resolveCountyAttempts,
  streetLineFromAddress,
} from './auto-enrich'
import { detectCounty, parseAddressForCounty } from './county-enrichment'
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

const kyleLead = {
  id: 'e5152e75-dbd8-4fa5-9c3b-f702c42d8b9b',
  phone: '+19135550100',
  property_address: '32220 W 91ST ST, De Soto, KS 66018',
  city: null,
  state: null,
  zip: null,
  county: null,
  source: 'mojo_call',
  is_parked: false,
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

  it('has no remaining Manifest bootstrap runtime', () => {
    expect(fs.existsSync('src/lib/manifest-sync.ts')).toBe(false)
  })
})

describe('county resolution for address-only Mojo leads', () => {
  it('detects Johnson County for De Soto KS 66018', () => {
    expect(detectCounty('De Soto', 'KS', '66018')).toEqual({ county: 'Johnson', state: 'KS' })
    expect(parseAddressForCounty('32220 W 91ST ST, De Soto, KS 66018')).toMatchObject({
      city: 'De Soto',
      state: 'KS',
      zip: '66018',
      county: 'Johnson',
    })
  })

  it('builds a Johnson County assessor attempt from a concatenated Mojo address', () => {
    expect(resolveCountyAttempts(kyleLead)).toEqual([
      expect.objectContaining({
        address: '32220 W 91ST ST',
        city: 'De Soto',
        state: 'KS',
        zip: '66018',
        county: 'Johnson',
      }),
    ])
    expect(streetLineFromAddress('32220 W 91ST ST, De Soto, KS 66018', {
      city: 'De Soto', state: 'KS', zip: '66018',
    })).toBe('32220 W 91ST ST')
  })

  it('uses Mojo event / prospect situs when the lead identity shell has no address', () => {
    expect(resolveCountyAttempts(
      { phone: '+19135550100', property_address: null, city: null, state: null, zip: null, county: null },
      [{ address: '32220 W 91ST ST', city: 'De Soto', state: 'KS', zip: '66018' }],
    )).toEqual([
      expect.objectContaining({
        address: '32220 W 91ST ST',
        city: 'De Soto',
        state: 'KS',
        zip: '66018',
        county: 'Johnson',
      }),
    ])
  })

  it('does not treat a thin prospect_match as county property facts', () => {
    expect(hasCountyPropertyFacts({ firstDelinquentYear: 2023, taxOwed: 24295.68, taxStatus: 'delinquent' })).toBe(false)
    expect(hasCountyPropertyFacts({
      bedrooms: 4, bathrooms: 3.5, sqft: 2085, assessedValue: 57523, ownerName: 'Kyle Wilson',
    })).toBe(true)
  })
})

describe('autoEnrichLead orchestration', () => {
  it('runs county assessor after a thin prospect_match and refuses to complete without housing facts', async () => {
    const enrichFromProspect = vi.fn().mockResolvedValue({
      matched: true,
      hint: { address: '32220 W 91ST ST', city: 'De Soto', state: 'KS', zip: '66018', county: 'Johnson' },
    })
    const enrichFromCountyAttempts = vi.fn().mockResolvedValue({ firstDelinquentYear: 2023 })
    const dependencies = {
      loadLead: vi.fn().mockResolvedValue(kyleLead),
      loadLocationHints: vi.fn().mockResolvedValue([]),
      loadExistingCountyFacts: vi.fn().mockResolvedValue({ firstDelinquentYear: 2023 }),
      completedSources: vi.fn().mockResolvedValue(new Set(['prospect_match'])),
      enrichFromProspect,
      enrichFromCountyAttempts,
    }

    await expect(autoEnrichLead(kyleLead.id, dependencies)).rejects.toThrow(
      'County assessor did not return property details',
    )
    expect(enrichFromProspect).not.toHaveBeenCalled()
    expect(enrichFromCountyAttempts).toHaveBeenCalledWith(
      kyleLead.id,
      [expect.objectContaining({ county: 'Johnson', state: 'KS', address: '32220 W 91ST ST' })],
      false,
    )
  })

  it('persists county housing facts even when the lead row has no city, state, or county', async () => {
    const countyFacts = {
      bedrooms: 4, bathrooms: 3.5, sqft: 2085, assessedValue: 57523,
      appraisedValue: 500200, taxOwed: 24295.68, ownerName: 'Kyle Wilson',
    }
    const enrichFromCountyAttempts = vi.fn().mockResolvedValue(countyFacts)
    const enrichFromProspect = vi.fn().mockResolvedValue({ matched: true, hint: null })

    await expect(autoEnrichLead(kyleLead.id, {
      loadLead: vi.fn().mockResolvedValue(kyleLead),
      loadLocationHints: vi.fn().mockResolvedValue([]),
      loadExistingCountyFacts: vi.fn().mockResolvedValue({}),
      completedSources: vi.fn().mockResolvedValue(new Set()),
      enrichFromProspect,
      enrichFromCountyAttempts,
    })).resolves.toBeUndefined()

    expect(enrichFromProspect).toHaveBeenCalledWith(kyleLead.id, kyleLead.phone, false)
    expect(enrichFromCountyAttempts).toHaveBeenCalledWith(
      kyleLead.id,
      [expect.objectContaining({ county: 'Johnson', state: 'KS' })],
      false,
    )
  })

  it('force-re-enriches with overwrite after a blank completed job', async () => {
    const enrichFromCountyAttempts = vi.fn().mockResolvedValue({
      bedrooms: 4, bathrooms: 3.5, sqft: 2085, ownerName: 'Kyle Wilson',
    })

    await expect(forceReenrichLead(kyleLead.id, {
      loadLead: vi.fn().mockResolvedValue(kyleLead),
      loadLocationHints: vi.fn().mockResolvedValue([]),
      enrichFromProspect: vi.fn().mockResolvedValue({ matched: true, hint: null }),
      enrichFromCountyAttempts,
    })).resolves.toEqual({
      success: true,
      prospectMatch: true,
      countyEnriched: true,
    })

    expect(enrichFromCountyAttempts).toHaveBeenCalledWith(
      kyleLead.id,
      [expect.objectContaining({ county: 'Johnson', state: 'KS' })],
      true,
    )
  })
})
