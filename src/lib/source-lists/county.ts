/**
 * Service-area county placement for code-violation rows and the prospect
 * backfill. Kansas City, Missouri is not a county: a "Kansas City" city name
 * never becomes Jackson. Zip is used first, except 64063 and 64080, which
 * cross county lines. Cass is never in the service area.
 */

export const SERVICE_AREA_COUNTIES = ['jackson', 'clay', 'platte', 'johnson', 'wyandotte'] as const
export type ServiceAreaCounty = (typeof SERVICE_AREA_COUNTIES)[number]
type ServiceState = 'MO' | 'KS'

const CLAY_ZIPS = new Set([
  64024, 64068, 64069, 64073, 64089,
  64116, 64117, 64118, 64119, 64144, 64155, 64156, 64157, 64158, 64161, 64162, 64165, 64166, 64167,
])

const PLATTE_ZIPS = new Set([
  64079, 64098,
  64150, 64151, 64152, 64153, 64154, 64163, 64164, 64168, 64190, 64195,
])

const JACKSON_ZIPS = new Set([
  64013, 64014, 64015, 64030,
  64050, 64051, 64052, 64053, 64054, 64055, 64056, 64057, 64058,
  64064, 64081, 64082, 64086,
  64101, 64102, 64105, 64106, 64108, 64109, 64110, 64111, 64112, 64113, 64114,
  64120, 64121, 64123, 64124, 64125, 64126, 64127, 64128, 64129, 64130, 64131, 64132, 64133, 64134,
  64136, 64137, 64138, 64139, 64145, 64146, 64147, 64148, 64149,
])

const JOHNSON_ZIPS = new Set([66013, 66018, 66019, 66021, 66030, 66031, 66061, 66062, 66083, 66085])

const CASS_ZIPS = new Set([64012, 64078, 64083, 64701])

const SPLIT_ZIPS = new Set([64063, 64080])

const CASS_CITIES = new Set([
  'belton', 'raymore', 'peculiar', 'harrisonville', 'pleasant hill', 'garden city', 'archie', 'cleveland', 'drexel',
])

const CITY_COUNTY: Record<string, { county: ServiceAreaCounty; state: ServiceState }> = {
  independence: { county: 'jackson', state: 'MO' },
  'blue springs': { county: 'jackson', state: 'MO' },
  raytown: { county: 'jackson', state: 'MO' },
  grandview: { county: 'jackson', state: 'MO' },
  'lees summit': { county: 'jackson', state: 'MO' },
  'sugar creek': { county: 'jackson', state: 'MO' },
  'grain valley': { county: 'jackson', state: 'MO' },
  'oak grove': { county: 'jackson', state: 'MO' },
  liberty: { county: 'clay', state: 'MO' },
  kearney: { county: 'clay', state: 'MO' },
  smithville: { county: 'clay', state: 'MO' },
  'excelsior springs': { county: 'clay', state: 'MO' },
  'north kansas city': { county: 'clay', state: 'MO' },
  gladstone: { county: 'clay', state: 'MO' },
  'pleasant valley': { county: 'clay', state: 'MO' },
  claycomo: { county: 'clay', state: 'MO' },
  'platte city': { county: 'platte', state: 'MO' },
  parkville: { county: 'platte', state: 'MO' },
  weston: { county: 'platte', state: 'MO' },
  riverside: { county: 'platte', state: 'MO' },
  'weatherby lake': { county: 'platte', state: 'MO' },
  'platte woods': { county: 'platte', state: 'MO' },
  'overland park': { county: 'johnson', state: 'KS' },
  olathe: { county: 'johnson', state: 'KS' },
  shawnee: { county: 'johnson', state: 'KS' },
  lenexa: { county: 'johnson', state: 'KS' },
  leawood: { county: 'johnson', state: 'KS' },
  'prairie village': { county: 'johnson', state: 'KS' },
  merriam: { county: 'johnson', state: 'KS' },
  gardner: { county: 'johnson', state: 'KS' },
  'de soto': { county: 'johnson', state: 'KS' },
  'spring hill': { county: 'johnson', state: 'KS' },
  stilwell: { county: 'johnson', state: 'KS' },
  'roeland park': { county: 'johnson', state: 'KS' },
  fairway: { county: 'johnson', state: 'KS' },
  westwood: { county: 'johnson', state: 'KS' },
  'mission hills': { county: 'johnson', state: 'KS' },
  'mission woods': { county: 'johnson', state: 'KS' },
  'lake quivira': { county: 'johnson', state: 'KS' },
  mission: { county: 'johnson', state: 'KS' },
  'bonner springs': { county: 'wyandotte', state: 'KS' },
  edwardsville: { county: 'wyandotte', state: 'KS' },
}

export interface CodeViolationPlace {
  county: ServiceAreaCounty | null
  outOfArea: boolean
}

export function placeName(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function canonicalServiceCounty(value: string | null | undefined): ServiceAreaCounty | null {
  const token = placeName(value).replace(/\b(county|missouri|kansas|mo|ks)\b/g, '').replace(/\s+/g, '')
  return (SERVICE_AREA_COUNTIES as readonly string[]).includes(token) ? token as ServiceAreaCounty : null
}

export function zipCode(value: string | null | undefined): number | null {
  const match = (value ?? '').match(/\b(6[46]\d{3})\b/)
  if (!match) return null
  return Number(match[1])
}

function countyFromZip(zip: number | null): ServiceAreaCounty | null {
  if (zip === null || SPLIT_ZIPS.has(zip) || CASS_ZIPS.has(zip)) return null
  if (CLAY_ZIPS.has(zip)) return 'clay'
  if (PLATTE_ZIPS.has(zip)) return 'platte'
  if (JACKSON_ZIPS.has(zip)) return 'jackson'
  if (JOHNSON_ZIPS.has(zip) || (zip >= 66200 && zip <= 66299)) return 'johnson'
  if (zip >= 66100 && zip <= 66119) return 'wyandotte'
  return null
}

export function countyForCity(city: string | null | undefined, state: string | null | undefined): { county: ServiceAreaCounty; state: ServiceState } | null {
  const name = placeName(city)
  const stateToken = placeName(state)
  const normalizedState = stateToken === 'mo' || stateToken === 'missouri'
    ? 'MO'
    : stateToken === 'ks' || stateToken === 'kansas'
      ? 'KS'
      : null
  if (name === 'kansas city' || name === 'kc') {
    return normalizedState === 'KS' ? { county: 'wyandotte', state: 'KS' } : null
  }
  const mapped = CITY_COUNTY[name]
  if (!mapped) return null
  if (normalizedState && mapped.state !== normalizedState) return null
  return mapped
}

function outsideServiceArea(record: Record<string, string>, zip: number | null, city: string): boolean {
  const explicit = placeName(
    record.county || record.situs_county || record.property_county || '',
  ).replace(/\b(county|missouri|kansas)\b/g, '').trim()
  if (explicit === 'cass' || explicit === 'cass county') return true
  if (explicit && !canonicalServiceCounty(explicit) && !['unknown', 'unresolved', ''].includes(explicit.replace(/\s+/g, ''))) {
    if (explicit !== 'unknown' && explicit !== 'unresolved') {
      const compact = explicit.replace(/\s+/g, '')
      if (compact && compact !== 'unknown' && compact !== 'unresolved' && !canonicalServiceCounty(explicit)) return true
    }
  }
  if (CASS_CITIES.has(city)) return true
  if (zip !== null && CASS_ZIPS.has(zip)) return true
  return false
}

const PARCEL_KEY = /(?:^|_)(jackson|clay|platte|johnson|wyandotte)(?:_|$)/

export function parcelMatchCounty(record: Record<string, string>): ServiceAreaCounty | null {
  const hits = new Set<ServiceAreaCounty>()
  for (const [key, value] of Object.entries(record)) {
    if (!value || !value.trim()) continue
    const match = key.toLowerCase().match(PARCEL_KEY)
    if (!match) continue
    if (!/parcel|match|pin/.test(key.toLowerCase()) && !key.startsWith('_')) continue
    hits.add(match[1] as ServiceAreaCounty)
  }
  return hits.size === 1 ? [...hits][0] : null
}

export function resolveCodeViolationPlace(record: Record<string, string>): CodeViolationPlace {
  const fromParcel = parcelMatchCounty(record)
  if (fromParcel) return { county: fromParcel, outOfArea: false }

  const city = placeName(record.city || record.situs_city || record.incident_city || '')
  const zip = zipCode(record.zip || record.zip_code || record.situs_zip || record.postal_code || record.address || record.incident_address || record.situs_address || '')
  if (outsideServiceArea(record, zip, city)) return { county: null, outOfArea: true }

  const explicit = canonicalServiceCounty(record.county || record.situs_county || '')
  if (explicit) return { county: explicit, outOfArea: false }

  const fromZip = countyFromZip(zip)
  if (fromZip) return { county: fromZip, outOfArea: false }

  const fromCity = countyForCity(city, record.state || record.situs_state || '')
  if (fromCity) return { county: fromCity.county, outOfArea: false }

  return { county: null, outOfArea: false }
}
