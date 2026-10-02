import { afterEach, describe, expect, it, vi } from 'vitest'
import { bearingToward, lookupStreetView } from './street-view'

const lead = {
  id: '11111111-1111-4111-8111-111111111111',
  property_address: '1600 Amphitheatre Parkway',
  city: 'Mountain View',
  state: 'CA',
  zip: '94043',
  assigned_agent: 'Ernest',
}

describe('mobile Street View lookup', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.GOOGLE_MAPS_API_KEY
  })

  it('aims from the panorama camera toward the property', () => {
    expect(bearingToward({ lat: 39, lng: -94.001 }, { lat: 39, lng: -94 })).toBeCloseTo(90, 1)
    expect(bearingToward({ lat: 38.999, lng: -94 }, { lat: 39, lng: -94 })).toBeCloseTo(0, 1)
  })

  it('uses a property geocode and outdoor panorama metadata without returning the key', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-secret-key'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'OK', results: [{ address_components: [{ long_name: '1600', types: ['street_number'] }], geometry: { location_type: 'ROOFTOP', location: { lat: 39, lng: -94 } } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'OK', pano_id: 'pano-1', location: { lat: 39, lng: -94.001 } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await lookupStreetView(lead)

    expect(result).toMatchObject({ available: true, panoId: 'pano-1', heading: expect.closeTo(90, 1), confidence: 'rooftop' })
    expect(JSON.stringify(result)).not.toContain('test-secret-key')
    expect(String(fetchMock.mock.calls[1][0])).toContain('source=outdoor')
  })

  it('reports missing imagery without fabricating a nearby panorama', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-secret-key'
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'OK', results: [{ address_components: [{ long_name: '1600', types: ['street_number'] }], geometry: { location_type: 'ROOFTOP', location: { lat: 39, lng: -94 } } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ZERO_RESULTS' }), { status: 200 })))
    await expect(lookupStreetView(lead)).resolves.toEqual({ available: false, reason: 'imagery_unavailable' })
  })

  it('rejects approximate or mismatched house geocodes before panorama lookup', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-secret-key'
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      status: 'OK', results: [{ partial_match: true, address_components: [{ long_name: '1602', types: ['street_number'] }], geometry: { location_type: 'APPROXIMATE', location: { lat: 39, lng: -94 } } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(lookupStreetView(lead)).resolves.toEqual({ available: false, reason: 'address_unverified' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
