export const INTAKE_CONTROL_COUNTIES = ['jackson', 'clay', 'platte', 'johnson', 'wyandotte'] as const

export type ForeclosureServiceCounty = (typeof INTAKE_CONTROL_COUNTIES)[number]
export type ForeclosureServiceState = 'MO' | 'KS'

const SERVICE_AREA_STATE: Record<ForeclosureServiceCounty, ForeclosureServiceState> = {
  jackson: 'MO',
  clay: 'MO',
  platte: 'MO',
  johnson: 'KS',
  wyandotte: 'KS',
}

function countyWords(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()
}

/** Exact county only. Case and a trailing "County" or "Co." are ignored. */
export function serviceAreaCounty(raw: unknown): ForeclosureServiceCounty | null {
  const match = countyWords(raw).match(/^(jackson|clay|platte|johnson|wyandotte)(?: (?:county|co))?$/)
  return match ? match[1] as ForeclosureServiceCounty : null
}

export function missingServiceCounty(raw: unknown): boolean {
  const value = countyWords(raw)
  if (!value) return true
  return value.replace(/ (?:county|co)$/, '') === 'unknown'
}

function explicitServiceState(raw: unknown): ForeclosureServiceState | 'other' | null {
  if (typeof raw !== 'string') return null
  const value = raw.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()
  if (!value) return null
  if (value === 'mo' || value === 'missouri') return 'MO'
  if (value === 'ks' || value === 'kansas') return 'KS'
  return 'other'
}

/**
 * Jackson, Clay, and Platte are Missouri. Johnson and Wyandotte are Kansas.
 * A blank state is taken from that county. Any other state is rejected.
 */
export function serviceAreaPlace(
  countyRaw: unknown,
  stateRaw?: unknown,
): { county: ForeclosureServiceCounty; state: ForeclosureServiceState } | null {
  const county = serviceAreaCounty(countyRaw)
  if (!county) return null
  const expected = SERVICE_AREA_STATE[county]
  const explicit = explicitServiceState(stateRaw)
  if (explicit === null) return { county, state: expected }
  if (explicit !== expected) return null
  return { county, state: expected }
}
