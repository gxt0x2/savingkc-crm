import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc } }))

import { readCountyProspectAudienceSummary } from './county-prospect-audiences'

describe('readCountyProspectAudienceSummary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('separates classified source records from the property-class review backlog', async () => {
    mocks.rpc.mockResolvedValue({ data: [
      { delinquency: '2yr', deceased: false, property_class: 'residential', total: 12, with_phone_candidate: 9, linked_leads: 2 },
      { delinquency: '3yr_plus', deceased: true, property_class: 'unknown', total: 30, with_phone_candidate: 5, linked_leads: 0 },
    ], error: null })

    await expect(readCountyProspectAudienceSummary()).resolves.toEqual({
      rows: [
        { delinquency: '2yr', deceased: false, propertyClass: 'residential', total: 12, withPhoneCandidate: 9, linkedLeads: 2 },
        { delinquency: '3yr_plus', deceased: true, propertyClass: 'unknown', total: 30, withPhoneCandidate: 5, linkedLeads: 0 },
      ],
      classified: 12,
      needsPropertyClass: 30,
      withPhoneCandidate: 14,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('county_prospect_audience_summary_v1')
  })
})
