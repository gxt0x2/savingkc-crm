import { formatPhone } from '@/lib/format'
import {
  FIRST_FORECLOSURE_COUNTIES,
  FORECLOSURE_EQUITY_FLOOR,
  NOTICE_TYPE_LABELS,
  auctionUrgency,
  daysUntilSale,
  formatEquity,
  formatUsDate,
  type AuctionUrgency,
  type ForeclosureNoticeType,
} from '@/lib/prospecting/foreclosure'

export type ForeclosureListSortKey = 'sale' | 'equity' | 'days' | 'owner'
export type ForeclosureListSortDirection = 'asc' | 'desc'

const EM_DASH = '—'

const COMPANY = /\b(LLC|L\.L\.C\.?|INC|INCORPORATED|CORP|CORPORATION|TRUST|ESTATE|PROPERTIES|PROPERTY|INVESTMENTS?|HOLDINGS|PARTNERS|PARTNERSHIP|LLP|\bLP\b|BANK|COMPANY|GROUP|ASSOCIATION|ASSOC|REALTY|HOMES|ENTERPRISES)\b/i
const SUFFIX = /^(JR|SR|II|III|IV|V)$/i
const INITIAL = /^[A-Z]$/i

function titleToken(token: string): string {
  const clean = token.replace(/\./g, '')
  if (!clean) return ''
  if (SUFFIX.test(clean) || /^(LLC|INC|LP|LLP|PC|PA|CO)$/i.test(clean)) return clean.toUpperCase()
  if (clean.length === 1) return clean.toUpperCase()
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase()
}

function nameTokens(value: string): string[] {
  return value.replace(/\./g, ' ').split(/\s+/).map((token) => token.trim()).filter(Boolean)
}

function formatCompany(value: string): string {
  return nameTokens(value).map((token) => titleToken(token)).join(' ')
}

function formatPerson(value: string, lastFirst: boolean): string {
  const tokens = nameTokens(value)
  if (tokens.length === 0) return ''
  let suffix = ''
  if (SUFFIX.test(tokens[tokens.length - 1] ?? '')) {
    const raw = tokens.pop()!.toUpperCase()
    suffix = raw === 'JR' || raw === 'SR' ? raw.charAt(0) + raw.slice(1).toLowerCase() : raw
  }
  if (tokens.length === 0) return suffix
  let first = tokens[0]
  let last = tokens[tokens.length - 1]
  if (tokens.length >= 3 && INITIAL.test(tokens[tokens.length - 1] ?? '')) {
    first = tokens[1]
    last = tokens[0]
  } else if (tokens.some((token, index) => index > 0 && index < tokens.length - 1 && INITIAL.test(token))) {
    first = tokens[0]
    last = tokens[tokens.length - 1]
  } else if (lastFirst && tokens.length >= 2) {
    last = tokens[0]
    first = tokens[1]
  }
  const name = tokens.length === 1 ? titleToken(tokens[0]) : `${titleToken(first)} ${titleToken(last)}`
  return suffix ? `${name} ${suffix}` : name
}

function sameLeadingToken(parts: readonly string[]): boolean {
  const leads = parts.map((part) => nameTokens(part)[0]?.toUpperCase() ?? '').filter(Boolean)
  return leads.length > 1 && leads.every((lead) => lead === leads[0])
}

function splitOwners(value: string): { parts: string[]; lastFirst: boolean } {
  if (/[;&]|\band\b/i.test(value)) {
    const parts = value.split(/\s*(?:;|&|\band\b)\s*/i).map((part) => part.trim()).filter(Boolean)
    return { parts, lastFirst: sameLeadingToken(parts) }
  }
  if (!value.includes(',')) return { parts: [value], lastFirst: false }
  const segments = value.split(',').map((part) => part.trim()).filter(Boolean)
  const first = nameTokens(segments[0] ?? '')
  const sharedSurname = segments.length > 1 && segments.every((segment) => {
    const tokens = nameTokens(segment)
    return tokens.length >= 2 && tokens[0]?.toUpperCase() === first[0]?.toUpperCase()
  })
  if (sharedSurname) return { parts: segments, lastFirst: true }
  if (segments.length >= 2 && first.length === 1) {
    const given = segments.slice(1).flatMap((segment) => nameTokens(segment))
    return { parts: [[first[0], ...given].join(' ')], lastFirst: true }
  }
  if (segments.every((segment) => nameTokens(segment).length >= 2)) {
    return { parts: segments, lastFirst: sameLeadingToken(segments) }
  }
  return { parts: [value], lastFirst: false }
}

/** Natural owner lines. One person is "First Last"; several are Owner 1 / Owner 2. */
export function foreclosureOwnerLines(name: string | null | undefined): string[] {
  const value = name?.replace(/\s+/g, ' ').trim() ?? ''
  if (!value || /^(unknown|n\/a|na)$/i.test(value)) return []
  const { parts, lastFirst } = splitOwners(value)
  const formatted = parts.map((part) => (COMPANY.test(part) ? formatCompany(part) : formatPerson(part, lastFirst))).filter(Boolean)
  const unique: string[] = []
  const seen = new Set<string>()
  for (const line of formatted) {
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(line)
  }
  if (unique.length <= 1) return unique
  return unique.map((line, index) => `Owner ${index + 1} ${line}`)
}

export function foreclosureOwnerLabel(name: string | null | undefined): string {
  const lines = foreclosureOwnerLines(name)
  return lines.length > 0 ? lines.join(' ') : EM_DASH
}

/** Phone rows use the same person as the heading when the contact is one of the owners. */
export function foreclosurePersonLabel(name: string | null | undefined, ownerName?: string | null): string {
  const contact = name?.replace(/\s+/g, ' ').trim() ?? ''
  if (ownerName) {
    const { parts } = splitOwners(ownerName.replace(/\s+/g, ' ').trim())
    const index = parts.findIndex((part) => part.replace(/\s+/g, ' ').trim().toLowerCase() === contact.toLowerCase())
    const matched = index >= 0 ? foreclosureOwnerLines(ownerName)[index] : undefined
    if (matched) return matched.replace(/^Owner \d+ /, '')
  }
  const direct = foreclosureOwnerLines(name)
  return direct[0]?.replace(/^Owner \d+ /, '') || 'Contact'
}

/** Ingest flags stay in the database. The agent Notes tab does not show them. */
export function foreclosureAgentNote(notes: string | null | undefined): string | null {
  const value = notes?.replace(/\s+/g, ' ').trim() ?? ''
  if (!value) return null
  if (/pub_in_week|needs_propstream|needs_smartskip|backfill|est_debt|est_equity/i.test(value)) return null
  return value
}

/** Known below-floor equity stays out of the default New dial queue. Unknown equity stays. */
export function foreclosureClearsDialFloor(estEquity: number | null | undefined): boolean {
  return estEquity == null || estEquity >= FORECLOSURE_EQUITY_FLOOR
}

function stripTail(value: string, token: string): string {
  const escaped = token.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!escaped) return value
  return value.replace(new RegExp(`[,\\s]+${escaped}\\s*$`, 'i'), '').trim()
}

/** Situs street only. City, state, ZIP, and a trailing county echo stay off the row. */
export function foreclosureStreetLine(
  situs: string | null | undefined,
  location?: { city?: string | null; state?: string | null; zip?: string | null },
): string {
  let street = situs?.replace(/\s+/g, ' ').trim() ?? ''
  if (!street) return EM_DASH
  const city = location?.city?.trim() ?? ''
  const state = location?.state?.trim() ?? ''
  const zip = location?.zip?.trim() ?? ''
  for (let pass = 0; pass < 4; pass += 1) {
    const before = street
    if (city && state) street = stripTail(street, `${city} ${state}`)
    if (zip) street = stripTail(street, zip)
    if (state) street = stripTail(street, state)
    if (city) street = stripTail(street, city)
    if (street === before) break
  }
  return street.replace(/[,\s]+$/, '').trim() || EM_DASH
}

const UNIT_WORD = /^(?:#\S*|apt\.?|unit|ste\.?|suite)$/i

/** Street on the first line. A unit (#J, Apt 2) drops to a second line. */
export function foreclosureStreetParts(
  situs: string | null | undefined,
  location?: { city?: string | null; state?: string | null; zip?: string | null },
): { street: string; unit: string | null } {
  const line = foreclosureStreetLine(situs, location)
  if (line === EM_DASH) return { street: line, unit: null }
  const tokens = line.split(/\s+/)
  const unitAt = tokens.findIndex((token) => UNIT_WORD.test(token))
  if (unitAt <= 0) return { street: line, unit: null }
  return {
    street: tokens.slice(0, unitAt).join(' '),
    unit: tokens.slice(unitAt).join(' '),
  }
}

function deduped(value: string | null | undefined): string {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const part of (value ?? '').split(',')) {
    const token = part.replace(/\s+/g, ' ').trim()
    if (!token) continue
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(token)
  }
  return kept.join(', ')
}

/** One city, state, and ZIP. Situs locality is not repeated after the street. */
export function foreclosurePostalAddress(
  situs: string | null | undefined,
  location?: { city?: string | null; state?: string | null; zip?: string | null },
): string {
  const street = foreclosureStreetLine(situs, location)
  let city = deduped(location?.city)
  const state = deduped(location?.state).split(',')[0]?.trim().toUpperCase() ?? ''
  const zipMatch = (location?.zip ?? '').match(/\d{5}(?:-\d{4})?/)
  const zip = zipMatch?.[0] ?? ''
  if (state) city = stripTail(city, state)
  if (zip) city = stripTail(city, zip)
  city = city.replace(/[,\s]+$/, '').trim()
  const locality = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  if (street === EM_DASH) return locality || EM_DASH
  return locality ? `${street}, ${locality}` : street
}

export function foreclosureCountyState(county: string | null | undefined, state: string | null | undefined): string {
  const known = FIRST_FORECLOSURE_COUNTIES.find((item) => item.county === county)
  if (known) return known.label
  const name = (county ?? '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
  const st = (state ?? '').trim().toUpperCase()
  return [name, st].filter(Boolean).join(' ') || EM_DASH
}

export function foreclosureMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EM_DASH
  return formatEquity(value)
}

export function foreclosureNoticeBadge(noticeType: ForeclosureNoticeType | null | undefined): string | null {
  if (!noticeType) return null
  return NOTICE_TYPE_LABELS[noticeType] ?? null
}

export function foreclosureListPhone(phones: readonly string[] | null | undefined): string {
  const phone = phones?.find((value) => value.trim())
  if (!phone) return EM_DASH
  return formatPhone(phone) || EM_DASH
}

export function foreclosureListHasPhone(phones: readonly string[] | null | undefined): boolean {
  return Boolean(phones?.some((value) => value.trim()))
}

export function foreclosureSalePresentation(saleDate: string | null, today: string): {
  label: string
  days: number | null
  tone: AuctionUrgency
} {
  const days = daysUntilSale(saleDate, today)
  return { label: formatUsDate(saleDate), days, tone: auctionUrgency(days) }
}

function compareNullableText(left: string | null, right: string | null, factor: number): number {
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  if (left === right) return 0
  return (left < right ? -1 : 1) * factor
}

function compareNullableNumber(left: number | null, right: number | null, factor: number): number {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  if (left === right) return 0
  return (left < right ? -1 : 1) * factor
}

export function sortForeclosureList<T extends { saleDate: string | null; estEquity: number | null; ownerName?: string | null }>(
  rows: readonly T[],
  key: ForeclosureListSortKey,
  direction: ForeclosureListSortDirection,
): T[] {
  const factor = direction === 'asc' ? 1 : -1
  return [...rows].sort((left, right) => {
    if (key === 'equity') return compareNullableNumber(left.estEquity, right.estEquity, factor)
    if (key === 'owner') return compareNullableText(foreclosureOwnerLabel(left.ownerName), foreclosureOwnerLabel(right.ownerName), factor)
    return compareNullableText(left.saleDate, right.saleDate, factor)
  })
}
