import type { AuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'

type Coordinates = { lat: number; lng: number }

export type StreetViewResult =
  | { available: false; reason: 'missing_address' | 'address_not_found' | 'address_unverified' | 'imagery_unavailable' }
  | { available: true; panoId: string; propertyCoords: Coordinates; panoramaCoords: Coordinates; heading: number; confidence: 'rooftop' | 'interpolated' }

export class StreetViewServiceError extends Error {}

function mapsKey(): string {
  for (const name of ['GOOGLE_MAPS_API_KEY', 'NEXT_PUBLIC_GMAPS_KEY', 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY']) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  throw new StreetViewServiceError('Street View is not configured.')
}

function coordinates(value: unknown): Coordinates | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  return typeof row.lat === 'number' && Number.isFinite(row.lat)
    && typeof row.lng === 'number' && Number.isFinite(row.lng)
    ? { lat: row.lat, lng: row.lng } : null
}

/** Compass bearing from panorama camera position toward the property's geocoded location. */
export function bearingToward(from: Coordinates, to: Coordinates): number {
  const radians = Math.PI / 180
  const latitude1 = from.lat * radians
  const latitude2 = to.lat * radians
  const longitudeDifference = (to.lng - from.lng) * radians
  const y = Math.sin(longitudeDifference) * Math.cos(latitude2)
  const x = Math.cos(latitude1) * Math.sin(latitude2)
    - Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(longitudeDifference)
  return (Math.atan2(y, x) / radians + 360) % 360
}

async function mapsJson(url: URL): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
  } catch {
    throw new StreetViewServiceError('Street View lookup is temporarily unavailable.')
  }
  if (!response.ok) throw new StreetViewServiceError('Street View lookup is temporarily unavailable.')
  const data: unknown = await response.json().catch(() => null)
  if (!data || typeof data !== 'object') throw new StreetViewServiceError('Street View lookup is temporarily unavailable.')
  return data as Record<string, unknown>
}

export async function lookupStreetView(lead: AuthorizedMobileLead): Promise<StreetViewResult> {
  const address = [lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
  if (!lead.property_address?.trim()) return { available: false, reason: 'missing_address' }
  const requestedStreetNumber = lead.property_address.trim().match(/^(\d+[a-z]?)(?:\s|$)/i)?.[1]?.toUpperCase()
  if (!requestedStreetNumber) return { available: false, reason: 'address_unverified' }
  const key = mapsKey()
  const geocodeUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  geocodeUrl.search = new URLSearchParams({ address, key }).toString()
  const geocode = await mapsJson(geocodeUrl)
  if (geocode.status === 'ZERO_RESULTS') return { available: false, reason: 'address_not_found' }
  if (geocode.status !== 'OK') throw new StreetViewServiceError('Street View lookup is temporarily unavailable.')
  const first = Array.isArray(geocode.results) ? geocode.results[0] as Record<string, unknown> | undefined : undefined
  const geometry = first?.geometry as Record<string, unknown> | undefined
  const locationType = geometry?.location_type
  const streetNumberComponent = Array.isArray(first?.address_components)
    ? first.address_components.find((component: unknown) => {
      const row = component as Record<string, unknown>
      return Array.isArray(row.types) && row.types.includes('street_number')
    }) as Record<string, unknown> | undefined : undefined
  const matchedStreetNumber = typeof streetNumberComponent?.long_name === 'string'
    ? streetNumberComponent.long_name.trim().toUpperCase() : ''
  if (first?.partial_match === true || matchedStreetNumber !== requestedStreetNumber
    || (locationType !== 'ROOFTOP' && locationType !== 'RANGE_INTERPOLATED')) {
    return { available: false, reason: 'address_unverified' }
  }
  const propertyCoords = coordinates(geometry?.location)
  if (!propertyCoords) return { available: false, reason: 'address_not_found' }

  const metadataUrl = new URL('https://maps.googleapis.com/maps/api/streetview/metadata')
  metadataUrl.search = new URLSearchParams({
    location: `${propertyCoords.lat},${propertyCoords.lng}`,
    radius: '50',
    source: 'outdoor',
    key,
  }).toString()
  const metadata = await mapsJson(metadataUrl)
  if (metadata.status === 'ZERO_RESULTS' || metadata.status === 'NOT_FOUND') {
    return { available: false, reason: 'imagery_unavailable' }
  }
  if (metadata.status !== 'OK') throw new StreetViewServiceError('Street View lookup is temporarily unavailable.')
  const panoId = typeof metadata.pano_id === 'string' ? metadata.pano_id : ''
  const panoramaCoords = coordinates(metadata.location)
  if (!panoId || !panoramaCoords) throw new StreetViewServiceError('Street View lookup is temporarily unavailable.')
  return {
    available: true,
    panoId,
    propertyCoords,
    panoramaCoords,
    heading: bearingToward(panoramaCoords, propertyCoords),
    confidence: locationType === 'ROOFTOP' ? 'rooftop' : 'interpolated',
  }
}

export async function fetchStreetViewImage(panoId: string, heading: number): Promise<Response> {
  const imageUrl = new URL('https://maps.googleapis.com/maps/api/streetview')
  imageUrl.search = new URLSearchParams({
    size: '640x360',
    pano: panoId,
    heading: String(Math.round(heading)),
    pitch: '0',
    fov: '80',
    key: mapsKey(),
  }).toString()
  try {
    const response = await fetch(imageUrl, { cache: 'no-store', signal: AbortSignal.timeout(10000) })
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
      throw new StreetViewServiceError('Street View image is temporarily unavailable.')
    }
    return response
  } catch {
    throw new StreetViewServiceError('Street View image is temporarily unavailable.')
  }
}
