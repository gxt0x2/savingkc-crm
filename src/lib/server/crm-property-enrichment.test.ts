import { describe, expect, it, vi } from 'vitest'

import { recordCanonicalPropertyEnrichment } from './crm-property-enrichment'

describe('canonical property enrichment command', () => {
  it('sends typed facts and provenance through the atomic service-role RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { propertyId: 'property-1', eventId: 'event-1' },
      error: null,
    })

    await expect(recordCanonicalPropertyEnrichment({
      leadId: 'lead-1',
      source: 'county_assessor',
      sourceReference: 'jackson-county',
      facts: { parcelId: 'parcel-1', sqft: 1400, taxOwed: 2500 },
      observedAt: '2026-08-24T05:00:00.000Z',
      overwrite: true,
    }, { rpc } as never)).resolves.toEqual({ propertyId: 'property-1', eventId: 'event-1' })

    expect(rpc).toHaveBeenCalledWith('record_crm_property_enrichment_v1', {
      p_lead_id: 'lead-1',
      p_source: 'county_assessor',
      p_source_reference: 'jackson-county',
      p_facts: { parcelId: 'parcel-1', sqft: 1400, taxOwed: 2500 },
      p_observed_at: '2026-08-24T05:00:00.000Z',
      p_overwrite: true,
    })
  })

  it('bootstraps a property link before recording facts for an identity-only lead', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { propertyId: 'property-1', linked: true }, error: null })
      .mockResolvedValueOnce({ data: { propertyId: 'property-1', eventId: 'event-1' }, error: null })

    await expect(recordCanonicalPropertyEnrichment({
      leadId: 'lead-1',
      source: 'prospect_match',
      sourceReference: 'prospect-1',
      facts: { parcelId: 'parcel-1', zestimate: 125000 },
      location: {
        address: '703 Wabash Ave',
        city: 'Kansas City',
        state: 'MO',
        zip: '64124',
        county: 'Jackson',
        parcelId: 'parcel-1',
      },
    }, { rpc } as never)).resolves.toEqual({ propertyId: 'property-1', eventId: 'event-1' })

    expect(rpc).toHaveBeenNthCalledWith(1, 'ensure_crm_property_link_v1', {
      p_lead_id: 'lead-1',
      p_source: 'prospect_match',
      p_address: '703 Wabash Ave',
      p_city: 'Kansas City',
      p_state: 'MO',
      p_zip: '64124',
      p_county: 'Jackson',
      p_parcel_id: 'parcel-1',
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'record_crm_property_enrichment_v1', expect.objectContaining({
      p_lead_id: 'lead-1',
      p_source: 'prospect_match',
      p_source_reference: 'prospect-1',
    }))
  })

  it('does not record facts when the canonical property cannot be bootstrapped', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'invalid_property_link_address' } })

    await expect(recordCanonicalPropertyEnrichment({
      leadId: 'lead-1',
      source: 'prospect_match',
      facts: { zestimate: 125000 },
      location: { address: '703 Wabash Ave', state: 'MO' },
    }, { rpc } as never)).rejects.toThrow('Canonical property bootstrap failed')

    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('fails honestly when canonical persistence is unavailable', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'schema unavailable' } })

    await expect(recordCanonicalPropertyEnrichment({
      leadId: 'lead-1', source: 'prospect_match', facts: { zestimate: 125000 },
    }, { rpc } as never)).rejects.toThrow('Canonical property enrichment failed')
  })
})
