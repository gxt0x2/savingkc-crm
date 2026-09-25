import { formatPhone } from '@/lib/format'
import {
  FIRST_FORECLOSURE_COUNTIES,
  NOTICE_TYPE_LABELS,
  auctionUrgency,
  daysUntilSale,
  formatEquity,
  formatUsDate,
  type AuctionUrgency,
  type ForeclosureNoticeType,
} from '@/lib/prospecting/foreclosure'

export type ForeclosureListSortKey = 'sale' | 'equity'
export type ForeclosureListSortDirection = 'asc' | 'desc'

const EM_DASH = '—'

export function foreclosureOwnerLabel(name: string | null | undefined): string {
  const value = name?.replace(/\s+/g, ' ').trim() ?? ''
  if (!value || /^(unknown|n\/a|na)$/i.test(value)) return EM_DASH
  return value
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

export function sortForeclosureList<T extends { saleDate: string | null; estEquity: number | null }>(
  rows: readonly T[],
  key: ForeclosureListSortKey,
  direction: ForeclosureListSortDirection,
): T[] {
  const factor = direction === 'asc' ? 1 : -1
  return [...rows].sort((left, right) => (
    key === 'sale'
      ? compareNullableText(left.saleDate, right.saleDate, factor)
      : compareNullableNumber(left.estEquity, right.estEquity, factor)
  ))
}
