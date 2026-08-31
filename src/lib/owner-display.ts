import { toProperCase } from '@/lib/format'

export interface OwnerGivenNameParts {
  first: string | null
  mi: string | null
  suffix: string | null
}

export interface OwnerDisplayParts extends OwnerGivenNameParts {
  last: string | null
  fullName: string
}

export interface StreetUnitParts {
  street: string | null
  unit: string | null
}

export interface ProspectOwnerLockFields {
  owner_1?: string | null
  owner_1_first?: string | null
  owner_1_mi?: string | null
  owner_1_last?: string | null
  owner_1_suffix?: string | null
  situs_street?: string | null
  situs_unit?: string | null
  situs_city?: string | null
  situs_state?: string | null
  situs_zip?: string | null
  mailing_street?: string | null
  mailing_unit?: string | null
  mailing_city?: string | null
  mailing_state?: string | null
  mailing_zip?: string | null
}

export interface OwnerAddressDisplay {
  street: string | null
  unit: string | null
  city: string | null
  state: string | null
  zip: string | null
}

const SUFFIX_BY_TOKEN: Record<string, string> = {
  JR: 'Jr',
  'JR.': 'Jr',
  JUNIOR: 'Jr',
  SR: 'Sr',
  'SR.': 'Sr',
  SENIOR: 'Sr',
  II: 'II',
  III: 'III',
  IV: 'IV',
}

const STREET_DIRECTIONALS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'])

const UNIT_TRAILING_RE = /(?:,\s*|\s+)(?:(UNIT|APT|APARTMENT|STE|SUITE)\.?\s+|#\s*)([A-Z0-9][A-Z0-9-]*)\s*$/i

function blankToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const clean = value.trim().replace(/\s+/g, ' ')
  return clean || null
}

function tokensOf(value: string): string[] {
  return value.split(/\s+/).map((token) => token.replace(/,$/, '')).filter(Boolean)
}

function mapSuffix(token: string): string | null {
  return SUFFIX_BY_TOKEN[token.replace(/[.,]$/, '').toUpperCase()] ?? null
}

function peelTrailingSuffixes(tokens: string[]): { tokens: string[]; suffix: string | null } {
  const suffixParts: string[] = []
  while (tokens.length > 1) {
    const mapped = mapSuffix(tokens[tokens.length - 1] ?? '')
    if (!mapped) break
    tokens.pop()
    suffixParts.unshift(mapped)
  }
  return { tokens, suffix: suffixParts.join(' ') || null }
}

export function titleCasePerson(value: string | null | undefined): string | null {
  const clean = blankToNull(value)
  return clean ? toProperCase(clean) : null
}

export function formatOwnerSuffix(value: string | null | undefined): string | null {
  const clean = blankToNull(value)
  if (!clean) return null
  const mapped = tokensOf(clean).map((token) => mapSuffix(token) ?? toProperCase(token))
  return mapped.join(' ') || null
}

export function titleCaseStreet(value: string | null | undefined): string | null {
  const clean = blankToNull(value)
  if (!clean) return null
  return tokensOf(clean).map((token) => {
    const core = token.replace(/[.,]$/, '')
    if (STREET_DIRECTIONALS.has(core.toUpperCase())) {
      return token.replace(core, core.toUpperCase())
    }
    return toProperCase(token)
  }).join(' ')
}

export function titleCaseCity(value: string | null | undefined): string | null {
  return titleCasePerson(value)
}

export function formatOwnerState(value: string | null | undefined): string | null {
  const clean = blankToNull(value)
  if (!clean) return null
  return clean.length === 2 ? clean.toUpperCase() : clean
}

export function formatOwnerZip(value: string | null | undefined): string | null {
  const clean = blankToNull(value)
  if (!clean) return null
  const digits = clean.replace(/\D/g, '')
  return digits.length >= 5 ? digits.slice(0, 5) : clean
}

/** Split a county given-name cell. First currently swallows MI or suffix. */
export function parseOwnerGivenName(value: string | null | undefined): OwnerGivenNameParts {
  const clean = blankToNull(value)
  if (!clean) return { first: null, mi: null, suffix: null }

  const { tokens, suffix } = peelTrailingSuffixes(tokensOf(clean))

  return {
    first: titleCasePerson(tokens[0] ?? null),
    mi: tokens.length > 1 ? tokens.slice(1).map((token) => titleCasePerson(token)).filter(Boolean).join(' ') || null : null,
    suffix,
  }
}

/** SmartSkip has no Suffix chip. Jr/Sr/II/III ride Last Name. */
export function parseOwnerFamilyName(value: string | null | undefined): { last: string | null; suffix: string | null } {
  const clean = blankToNull(value)
  if (!clean) return { last: null, suffix: null }

  const { tokens, suffix } = peelTrailingSuffixes(tokensOf(clean))
  return {
    last: tokens.map((token) => titleCasePerson(token)).filter(Boolean).join(' ') || null,
    suffix,
  }
}

/** Fold CRM suffix back onto Last Name for SmartSkip. Never emit a Suffix chip. */
export function formatSmartSkipLastName(
  last: string | null | undefined,
  suffix?: string | null,
): string | null {
  const family = parseOwnerFamilyName(last)
  return [family.last, formatOwnerSuffix(suffix) || family.suffix].filter(Boolean).join(' ') || null
}

/** Split a county street cell. Street currently swallows Apt/Ste/Unit. */
export function parseStreetUnit(value: string | null | undefined): StreetUnitParts {
  const clean = blankToNull(value)
  if (!clean) return { street: null, unit: null }

  const match = UNIT_TRAILING_RE.exec(clean)
  const label = match?.[1] ?? null
  const rawValue = match?.[2] ?? null
  if (!match || !rawValue) {
    return { street: titleCaseStreet(clean), unit: null }
  }

  const street = titleCaseStreet(clean.slice(0, match.index))
  const unitValue = rawValue.toUpperCase() === rawValue
    ? toProperCase(rawValue)
    : rawValue
  const unit = label
    ? `${toProperCase(label)} ${unitValue}`
    : `#${rawValue}`
  return { street, unit }
}

function hasStoredValue(value: string | null | undefined): boolean {
  return Boolean(blankToNull(value))
}

export function resolveOwnerDisplay(
  prospect: ProspectOwnerLockFields | null | undefined,
  leadName?: string | null,
): OwnerDisplayParts {
  const storedFirst = titleCasePerson(prospect?.owner_1_first)
  const storedMi = titleCasePerson(prospect?.owner_1_mi)
  const storedSuffix = formatOwnerSuffix(prospect?.owner_1_suffix)
  const given = hasStoredValue(prospect?.owner_1_mi) || hasStoredValue(prospect?.owner_1_suffix)
    ? { first: storedFirst, mi: storedMi, suffix: storedSuffix }
    : parseOwnerGivenName(prospect?.owner_1_first)
  const family = hasStoredValue(prospect?.owner_1_suffix)
    ? { last: titleCasePerson(prospect?.owner_1_last), suffix: storedSuffix }
    : parseOwnerFamilyName(prospect?.owner_1_last)

  const first = given.first
  const mi = given.mi
  const last = family.last
  const suffix = given.suffix || family.suffix
  const fullName = [first, mi, last, suffix].filter(Boolean).join(' ')
    || titleCasePerson(prospect?.owner_1)
    || titleCasePerson(leadName)
    || ''

  return { first, mi, last, suffix, fullName }
}

export function formatOwnerDisplayName(
  prospect: ProspectOwnerLockFields | null | undefined,
  leadName?: string | null,
): string {
  return resolveOwnerDisplay(prospect, leadName).fullName
}

export function resolveAddressDisplay(
  street: string | null | undefined,
  unit: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined,
  zip: string | null | undefined,
): OwnerAddressDisplay {
  const parsed = hasStoredValue(unit)
    ? { street: titleCaseStreet(street), unit: titleCaseStreet(unit) }
    : parseStreetUnit(street)
  return {
    street: parsed.street,
    unit: parsed.unit,
    city: titleCaseCity(city),
    state: formatOwnerState(state),
    zip: formatOwnerZip(zip),
  }
}

export function resolveSitusDisplay(
  prospect: ProspectOwnerLockFields | null | undefined,
  fallback?: { street?: string | null; city?: string | null; state?: string | null; zip?: string | null },
): OwnerAddressDisplay {
  return resolveAddressDisplay(
    prospect?.situs_street ?? fallback?.street,
    prospect?.situs_unit,
    prospect?.situs_city ?? fallback?.city,
    prospect?.situs_state ?? fallback?.state,
    prospect?.situs_zip ?? fallback?.zip,
  )
}

export function resolveMailingDisplay(
  prospect: ProspectOwnerLockFields | null | undefined,
): OwnerAddressDisplay {
  return resolveAddressDisplay(
    prospect?.mailing_street,
    prospect?.mailing_unit,
    prospect?.mailing_city,
    prospect?.mailing_state,
    prospect?.mailing_zip,
  )
}

export function joinOwnerAddress(parts: OwnerAddressDisplay): string {
  const streetLine = [parts.street, parts.unit].filter(Boolean).join(' ')
  const cityStateZip = [parts.city, [parts.state, parts.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [streetLine, cityStateZip].filter(Boolean).join(', ')
}
