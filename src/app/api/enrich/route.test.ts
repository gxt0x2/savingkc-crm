import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LEAD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  enrich: vi.fn(),
  record: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireUserOrSecret: mocks.authorize }))
vi.mock('@/lib/county-enrichment', () => ({
  CountyEnrichmentService: class { enrich = mocks.enrich },
}))
vi.mock('@/lib/server/crm-property-enrichment', () => ({ recordCanonicalPropertyEnrichment: mocks.record }))

import { POST } from './route'

function request(body: unknown) {
  return new NextRequest('https://crm.savingkc.com/api/enrich', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

describe('county enrichment API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue(null)
    mocks.enrich.mockResolvedValue({
      success: true, county: 'Jackson', parcelId: 'parcel-1', appraisedValue: 180000,
      source: 'jackson-county', fetchedAt: '2026-08-24T05:00:00.000Z',
    })
    mocks.record.mockResolvedValue({ propertyId: 'property-1', eventId: 'event-1' })
  })

  it('requires the canonical lead id instead of a Manifest identifier', async () => {
    const response = await POST(request({ address: '100 Main', state: 'MO', county: 'Jackson', manifest_id: 'legacy-1' }))
    expect(response.status).toBe(410)
    expect(mocks.enrich).not.toHaveBeenCalled()
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('persists successful provider output before reporting success', async () => {
    const response = await POST(request({ lead_id: LEAD_ID, address: '100 Main', state: 'MO', county: 'Jackson' }))
    expect(response.status).toBe(200)
    expect(mocks.enrich).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: LEAD_ID, address: '100 Main', state: 'MO', county: 'Jackson' }),
      false,
    )
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      leadId: LEAD_ID,
      source: 'county_assessor',
      sourceReference: 'jackson-county',
      facts: expect.objectContaining({ parcelId: 'parcel-1', appraisedValue: 180000 }),
      location: {
        address: '100 Main',
        city: null,
        state: 'MO',
        zip: null,
        county: 'Jackson',
        parcelId: 'parcel-1',
      },
    }))
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      canonical: { propertyId: 'property-1', eventId: 'event-1' },
    })
  })

  it('bypasses the property cache when forceRefresh is requested', async () => {
    const response = await POST(request({
      lead_id: LEAD_ID, address: '100 Main', state: 'MO', county: 'Jackson', forceRefresh: true,
    }))
    expect(response.status).toBe(200)
    expect(mocks.enrich).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: true }), true)
  })

  it('fails honestly when provider data cannot be persisted', async () => {
    mocks.record.mockRejectedValue(new Error('database unavailable'))
    const response = await POST(request({ lead_id: LEAD_ID, address: '100 Main', state: 'MO', county: 'Jackson' }))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ success: false })
  })
})
