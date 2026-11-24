/**
 * Service area for expired intake. Cass is outside it.
 * County comes from the zip seed or a parcel record, never a hardcoded county.
 */

export const SERVICE_PLACES = [
  { county: 'jackson', state: 'MO' },
  { county: 'clay', state: 'MO' },
  { county: 'platte', state: 'MO' },
  { county: 'wyandotte', state: 'KS' },
  { county: 'johnson', state: 'KS' },
] as const

export type ServicePlace = { county: string; state: 'MO' | 'KS' }

export function servicePlace(
  county: string | null | undefined,
  state: string | null | undefined,
): ServicePlace | null {
  const normalizedCounty = (county ?? '').trim().toLowerCase()
  const normalizedState = (state ?? '').trim().toUpperCase()
  if (!normalizedCounty || normalizedCounty === 'cass' || normalizedCounty === 'unknown' || normalizedCounty === 'unresolved') {
    return null
  }
  const match = SERVICE_PLACES.find((place) => place.county === normalizedCounty && place.state === normalizedState)
  return match ? { county: match.county, state: match.state } : null
}
