import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { parseForeclosureCsvTable } from '@/lib/prospecting/foreclosure-csv'
import {
  absenteeOwnerSignal,
  ownerNameSignals,
  parseNoticeTimeline,
  parseNoticeType,
  parseOutreachCount,
  parseSaleStatus,
  type ForeclosureNoticeType,
  type NoticeTimelineEvent,
  type SaleStatus,
} from '@/lib/prospecting/foreclosure-notice'

export * from '@/lib/prospecting/foreclosure-notice'

export const FORECLOSURE_EQUITY_FLOOR = 75_000
export const FORECLOSURE_PRIORITY_EQUITY = 100_000
export const FORECLOSURE_IMPORT_LIMIT = 200

export const FORECLOSURE_STATUSES = [
  'new',
  'equity_screened',
  'skip_traced',
  'callable',
  'contacted',
  'dnc',
  'dead',
] as const

export const FORECLOSURE_NOTICE_LIFECYCLES = [
  'unknown',
  'notice',
  'confirmed',
  'scheduled_sale',
  'sold',
  'cancelled',
  'reinstated',
] as const

export const EQUITY_BANDS = [
  'strong_100k+',
  'ideal_75k+',
  'thin_40_74',
  'kill_lt40',
  'unknown',
] as const

export const OWNER_ENTITIES = ['person', 'llc', 'trust', 'estate', 'unknown'] as const

export type ForeclosureStatus = (typeof FORECLOSURE_STATUSES)[number]
export type ForeclosureNoticeLifecycle = (typeof FORECLOSURE_NOTICE_LIFECYCLES)[number]
export type EquityBand = (typeof EQUITY_BANDS)[number]
export type OwnerEntity = (typeof OWNER_ENTITIES)[number]

export const STATUS_LABELS: Record<ForeclosureStatus, string> = {
  new: 'New',
  equity_screened: 'Equity screened',
  skip_traced: 'Skip traced',
  callable: 'Callable',
  contacted: 'Contacted',
  dnc: 'DNC',
  dead: 'Dead',
}

export const EQUITY_BAND_LABELS: Record<EquityBand, string> = {
  'strong_100k+': '$100k+ priority',
  'ideal_75k+': '$75k floor',
  thin_40_74: 'Thin $40–74k',
  kill_lt40: 'Below $40k',
  unknown: 'Unknown',
}

export const FIRST_FORECLOSURE_COUNTIES = [
  { county: 'jackson', state: 'MO', label: 'Jackson MO' },
  { county: 'johnson', state: 'KS', label: 'Johnson KS' },
] as const

const COUNTY_STATE: Record<string, string> = {
  jackson: 'MO',
  clay: 'MO',
  platte: 'MO',
  cass: 'MO',
  johnson: 'KS',
  wyandotte: 'KS',
  miami: 'KS',
}

const LOCKED_STATUSES = new Set<ForeclosureStatus>(['contacted', 'dnc', 'dead'])

export interface NormalizedForeclosure {
  externalRowId: string | null
  county: string
  state: string
  status: ForeclosureStatus
  noticeLifecycle: ForeclosureNoticeLifecycle
  sourceName: string | null
  sourceUrl: string | null
  sourceLayer: string | null
  pullDate: string | null
  noticeOrFilingDate: string | null
  saleDate: string | null
  saleTime: string | null
  saleLocation: string | null
  caseNumber: string | null
  instrumentNumber: string | null
  bookPage: string | null
  docType: string | null
  ownerName: string | null
  ownerEntity: OwnerEntity
  plaintiffLender: string | null
  trusteeOrFirm: string | null
  situs: string | null
  city: string | null
  zip: string | null
  legalDescription: string | null
  parcelId: string | null
  openingBid: number | null
  minBid: number | null
  amountClaimed: number | null
  notes: string | null
  recorderConfirmed: boolean
  courtConfirmed: boolean
  estValue: number | null
  estValueSource: string | null
  estDebt: number | null
  estDebtSource: string | null
  estEquity: number | null
  equityBand: EquityBand
  preferable: boolean
  skiptraceVendor: 'smartskip' | null
  skiptraceDate: string | null
  skiptraceBatchId: string | null
  phones: string[]
  email: string | null
  deceased: boolean
  skiptraceNotes: string | null
  latitude: number | null
  longitude: number | null
  /** @deprecated Alias of outreachCount. Legal filings are noticeType, not this count. */
  noticesSent: number
  outreachCount: number
  attorneyName: string | null
  saleStatus: SaleStatus
  noticeType: ForeclosureNoticeType | null
  noticeTypeSource: string | null
  noticeTimeline: NoticeTimelineEvent[]
  absentee: boolean
  ownerSignals: string[]
  mailingAddress: string | null
}

export type ForeclosureNormalizeResult = {
  ok: true
  record: NormalizedForeclosure
  warnings: string[]
} | {
  ok: false
  reason: string
}

export interface ForeclosureCsvResult {
  accepted: NormalizedForeclosure[]
  rejected: Array<{ row: number; reason: string }>
  warnings: Array<{ row: number; message: string }>
}

/** Fixed downtown Kansas City pin for the fictional 100 Sandbox Court row. Not a geocoded residence. */
export const SANDBOX_FORECLOSURE_POINT = { latitude: 39.084, longitude: -94.585 }
export const FORECLOSURE_SALE_WEEK_DAYS = 7

export function formatEquity(value: number | null): string {
  if (value == null) return 'Unknown'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

export function equityBand(equity: number): EquityBand {
  if (equity >= FORECLOSURE_PRIORITY_EQUITY) return 'strong_100k+'
  if (equity >= FORECLOSURE_EQUITY_FLOOR) return 'ideal_75k+'
  if (equity >= 40_000) return 'thin_40_74'
  return 'kill_lt40'
}

export function normalizeLegacyEquityBand(raw: unknown): EquityBand | null {
  const value = text(raw)?.toLowerCase()
  if (!value) return null
  if (value === 'ideal_100k+' || value === 'strong_100k+') return 'strong_100k+'
  if (value === 'preferable_75_99' || value === 'ideal_75k+') return 'ideal_75k+'
  if (value === 'thin_40_74' || value === 'kill_lt40' || value === 'unknown') return value
  return null
}

export function classifyOwnerEntity(name: string | null | undefined): OwnerEntity {
  const signals = ownerNameSignals(name)
  if (signals.includes('estate')) return 'estate'
  if (signals.includes('trust')) return 'trust'
  if (signals.includes('llc')) return 'llc'
  return text(name) ? 'person' : 'unknown'
}

export function normalizeCounty(raw: unknown): string | null {
  const value = text(raw)?.toLowerCase()
  if (!value) return null
  if (/\bjackson\b/.test(value)) return 'jackson'
  if (/\bjohnson\b/.test(value)) return 'johnson'
  const slug = value.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').replace(/_county$/, '')
  return /^[a-z][a-z0-9_]{0,40}$/.test(slug) ? slug : null
}

export function inferState(county: string, raw: unknown): string | null {
  const explicit = text(raw)?.toUpperCase()
  if (explicit && /^[A-Z]{2}$/.test(explicit)) return explicit
  return COUNTY_STATE[county] ?? null
}

export function parseMoney(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return roundMoney(raw)
  const value = text(raw)?.replace(/[$,\s]/g, '')
  if (!value || value === '-' || value.toLowerCase() === 'n/a') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? roundMoney(parsed) : null
}

export function parseIsoDate(raw: unknown): string | null {
  const value = text(raw)
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return null
  return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

export function parseFlag(raw: unknown): boolean {
  const value = text(raw)?.toLowerCase()
  return Boolean(value && ['y', 'yes', 'true', '1', 't'].includes(value))
}

export function parseSkipVendor(raw: unknown): 'smartskip' | 'rejected' | null {
  const value = text(raw)?.toLowerCase().replace(/[^a-z]/g, '')
  if (!value) return null
  return value === 'smartskip' ? 'smartskip' : 'rejected'
}

export function collectPhones(values: unknown[]): string[] {
  const phones: string[] = []
  for (const value of values) {
    const phone = normalizePhoneToE164(typeof value === 'number' ? value : text(value))
    if (!phone || phones.includes(phone)) continue
    phones.push(phone)
    if (phones.length === 3) break
  }
  return phones
}

export function preferableEquity(value: number | null, equity: number | null): boolean {
  if (value == null || equity == null) return false
  return equity - (0.08 * value) >= FORECLOSURE_EQUITY_FLOOR
}

export function dialReadyBlockers(input: {
  ownerEntity: OwnerEntity
  deceased: boolean
  vendor: 'smartskip' | null
  phones: string[]
  estEquity: number | null
  status: ForeclosureStatus
}): string[] {
  const blockers: string[] = []
  if (input.status === 'dnc') blockers.push('This owner is marked do not call.')
  if (input.status === 'dead') blockers.push('This record is dead.')
  if (input.ownerEntity !== 'person') blockers.push('Only person owners can be skip-traced or dialed.')
  if (input.deceased) blockers.push('SmartSkip marked this owner deceased.')
  if (input.estEquity == null || input.estEquity < FORECLOSURE_EQUITY_FLOOR) blockers.push('Estimated equity is below the $75,000 floor.')
  if (input.vendor !== 'smartskip') blockers.push('Phones must come from SmartSkip.')
  if (input.phones.length < 1) blockers.push('No SmartSkip phone is on file.')
  return blockers
}

export function isDialReady(record: Pick<NormalizedForeclosure, 'ownerEntity' | 'deceased' | 'skiptraceVendor' | 'phones' | 'estEquity' | 'status'>): boolean {
  return dialReadyBlockers({
    ownerEntity: record.ownerEntity,
    deceased: record.deceased,
    vendor: record.skiptraceVendor,
    phones: record.phones,
    estEquity: record.estEquity,
    status: record.status,
  }).length === 0
}

export function deriveForeclosureStatus(
  current: ForeclosureStatus,
  facts: Pick<NormalizedForeclosure, 'ownerEntity' | 'deceased' | 'skiptraceVendor' | 'phones' | 'estEquity' | 'estValue' | 'estDebt'>,
): ForeclosureStatus {
  if (LOCKED_STATUSES.has(current)) return current
  const screened = facts.estEquity != null || (facts.estValue != null && facts.estDebt != null)
  const traced = facts.skiptraceVendor === 'smartskip'
    && facts.ownerEntity === 'person'
    && facts.phones.length > 0
    && facts.estEquity != null
    && facts.estEquity >= FORECLOSURE_EQUITY_FLOOR
  if (traced && !facts.deceased) return 'callable'
  if (traced) return 'skip_traced'
  if (screened) return 'equity_screened'
  return 'new'
}

export function isSandboxForeclosureAddress(situs: string | null | undefined): boolean {
  return (situs ?? '').trim().toLowerCase() === '100 sandbox court'
}

export function explicitForeclosureCoordinates(input: { latitude?: unknown; longitude?: unknown }): { latitude: number; longitude: number } | null {
  const latitude = parseCoordinate(input.latitude, 'lat')
  const longitude = parseCoordinate(input.longitude, 'lng')
  if (latitude == null || longitude == null) return null
  return { latitude, longitude }
}

export function foreclosureCoordinates(input: { latitude?: unknown; longitude?: unknown; situs?: string | null }): { latitude: number; longitude: number } | null {
  return explicitForeclosureCoordinates(input) ?? (isSandboxForeclosureAddress(input.situs) ? SANDBOX_FORECLOSURE_POINT : null)
}

export function chicagoDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function addIsoDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function saleWithinWeek(saleDate: string | null, today: string): boolean {
  if (!saleDate) return false
  return saleDate >= today && saleDate <= addIsoDays(today, FORECLOSURE_SALE_WEEK_DAYS - 1)
}

export function daysUntilSale(saleDate: string | null, today: string): number | null {
  if (!saleDate) return null
  const start = Date.parse(`${today}T00:00:00Z`)
  const end = Date.parse(`${saleDate}T00:00:00Z`)
  return Math.round((end - start) / 86_400_000)
}

export function saleTimingLabel(saleDate: string | null, today: string): string {
  const days = daysUntilSale(saleDate, today)
  if (days == null) return 'No sale date'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days > 1) return `In ${days} days`
  if (days === -1) return 'Yesterday'
  return `${Math.abs(days)} days ago`
}

export function formatUsDate(isoDate: string | null): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return '—'
  const [year, month, day] = isoDate.split('-')
  return `${month}/${day}/${year}`
}

export function formatSaleDate(isoDate: string | null): string {
  return formatUsDate(isoDate)
}

export function parseNoticesSent(raw: unknown): { count: number; warning: string | null } {
  if (raw == null || raw === '') return { count: 0, warning: null }
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(value) || value < 0 || value > 999) {
    return { count: 0, warning: 'Notices sent was ignored because it was not a count from 0 to 999.' }
  }
  return { count: Math.floor(value), warning: null }
}

export function listRowPhones(dialReady: boolean, phones: string[]): string[] {
  return dialReady ? phones.filter(Boolean) : []
}

export interface ForeclosureMapPin {
  id: string
  ownerName: string
  latitude: number
  longitude: number
  dialReady: boolean
}

export function foreclosureMapPins(rows: Array<{
  id: string
  ownerName: string
  latitude: number | null
  longitude: number | null
  dialReady: boolean
}>): ForeclosureMapPin[] {
  return rows.flatMap((row) => {
    if (row.latitude == null || row.longitude == null) return []
    if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) return []
    return [{ id: row.id, ownerName: row.ownerName, latitude: row.latitude, longitude: row.longitude, dialReady: row.dialReady }]
  })
}

export function compareForeclosureQueue(
  left: { saleDate: string | null; estEquity: number | null },
  right: { saleDate: string | null; estEquity: number | null },
): number {
  const leftSale = left.saleDate ?? '9999-12-31'
  const rightSale = right.saleDate ?? '9999-12-31'
  if (leftSale !== rightSale) return leftSale < rightSale ? -1 : 1
  const rank = (equity: number | null) => {
    if (equity != null && equity >= FORECLOSURE_PRIORITY_EQUITY) return 0
    if (equity != null && equity >= FORECLOSURE_EQUITY_FLOOR) return 1
    return 2
  }
  const byRank = rank(left.estEquity) - rank(right.estEquity)
  if (byRank !== 0) return byRank
  return (right.estEquity ?? -1) - (left.estEquity ?? -1)
}

export function foreclosureCallingHref(prospectId: string, recordId: string): string {
  const query = new URLSearchParams({
    prospect_ids: prospectId,
    queue_label: 'Mortgage Foreclosure',
    return_to: `/prospecting/foreclosure/${recordId}`,
  })
  return `/prospecting?${query.toString()}`
}

export function normalizeForeclosureInput(
  input: Record<string, unknown>,
  currentStatus: ForeclosureStatus = 'new',
): ForeclosureNormalizeResult {
  const warnings: string[] = []
  if (isTaxRecord(input)) {
    return { ok: false, reason: 'Tax and DLT rows stay out of mortgage foreclosure.' }
  }

  const county = normalizeCounty(input.county)
  if (!county) return { ok: false, reason: 'County is required.' }
  const state = inferState(county, input.state)
  if (!state) return { ok: false, reason: 'State is required when the county is outside the first metro set.' }

  const ownerName = clip(input.ownerName ?? input.owner_name_norm ?? input.owner_name_raw, 200)
  const situs = clip(input.situs ?? input.situs_norm ?? input.situs_raw, 300)
  if (!ownerName) return { ok: false, reason: 'Owner name is required.' }
  if (!situs) return { ok: false, reason: 'Property address is required.' }

  const nameSignals = ownerNameSignals(ownerName)
  const ownerEntity = classifyOwnerEntity(ownerName)
  const mailingAddress = clip(input.mailingAddress ?? input.mailing_address ?? input.owner_mailing, 300)
  const absentee = absenteeOwnerSignal({
    ownerEntity,
    mailingAddress,
    situs,
    ownerState: text(input.ownerState ?? input.owner_state),
    propertyState: state,
  })
  // Entity and absentee signals are recorded before phones. Relatives skip is
  // not part of this pass; a late-stage optional skip can be added without a vendor.
  const estValue = parseMoney(input.estValue ?? input.est_value)
  const estDebt = parseMoney(input.estDebt ?? input.est_debt)
  const equity = estValue != null && estDebt != null
    ? { estEquity: roundMoney(estValue - estDebt), band: equityBand(roundMoney(estValue - estDebt)) }
    : { estEquity: null, band: 'unknown' as const }

  let vendor = parseSkipVendor(input.skiptraceVendor ?? input.skiptrace_vendor)
  let phones = collectPhones([input.phone1 ?? input.phone_1, input.phone2 ?? input.phone_2, input.phone3 ?? input.phone_3])
  let deceased = parseFlag(input.deceased ?? input.deceased_flag)
  let skiptraceDate = parseIsoDate(input.skiptraceDate ?? input.skiptrace_date)
  let skiptraceBatchId = clip(input.skiptraceBatchId ?? input.skiptrace_batch_id, 80)
  let skiptraceNotes = clip(input.skiptraceNotes ?? input.skiptrace_notes, 1000)
  const equityClearsFloor = equity.estEquity != null && equity.estEquity >= FORECLOSURE_EQUITY_FLOOR

  if (vendor === 'rejected') {
    warnings.push('Only SmartSkip phones are stored. Other skip-trace vendors were ignored.')
    vendor = null
    phones = []
    deceased = false
    skiptraceDate = null
    skiptraceBatchId = null
    skiptraceNotes = null
  }
  if ((vendor === 'smartskip' || phones.length > 0) && ownerEntity !== 'person') {
    warnings.push(`SmartSkip was ignored because the owner is not a person. Owner-name signals (${nameSignals.join(', ') || ownerEntity}) were applied before phones.`)
    vendor = null
    phones = []
    deceased = false
    skiptraceDate = null
    skiptraceBatchId = null
    skiptraceNotes = null
  }
  if ((vendor === 'smartskip' || phones.length > 0) && !equityClearsFloor) {
    warnings.push('SmartSkip was ignored until estimated equity is at least $75,000.')
    vendor = null
    phones = []
    deceased = false
    skiptraceDate = null
    skiptraceBatchId = null
    skiptraceNotes = null
  }
  if (phones.length > 0 && vendor !== 'smartskip') {
    warnings.push('Phones were ignored until the skip-trace vendor is SmartSkip.')
    phones = []
  }
  if (vendor === 'smartskip' && phones.length === 0 && !deceased) {
    warnings.push('SmartSkip was recorded without a usable phone.')
  }

  const latitudeRaw = input.latitude ?? input.lat
  const longitudeRaw = input.longitude ?? input.lng ?? input.lon
  const explicitCoordinates = explicitForeclosureCoordinates({ latitude: latitudeRaw, longitude: longitudeRaw })
  if ((text(latitudeRaw) || text(longitudeRaw)) && !explicitCoordinates) {
    warnings.push('Latitude and longitude were ignored because the pair was incomplete or out of range.')
  }
  const coordinates = explicitCoordinates ?? (isSandboxForeclosureAddress(situs) ? SANDBOX_FORECLOSURE_POINT : null)
  const outreach = parseOutreachCount(
    input.outreachCount ?? input.outreach_count ?? input.noticesSent ?? input.notices_sent ?? input.notice_count,
  )
  if (outreach.warning) warnings.push(outreach.warning)
  const noticeLifecycle = parseNoticeLifecycle(input.noticeLifecycle ?? input.lifecycle_status)
  const noticeType = parseNoticeType(input.noticeType ?? input.notice_type, input.docType ?? input.doc_type)
  const noticeTypeSource = clip(
    input.noticeTypeSource ?? input.notice_type_source ?? input.sourceName ?? input.source_name,
    120,
  )

  const facts = {
    ownerEntity,
    deceased,
    skiptraceVendor: vendor === 'smartskip' ? 'smartskip' as const : null,
    phones,
    estEquity: equity.estEquity,
    estValue,
    estDebt,
  }
  const status = deriveForeclosureStatus(currentStatus, facts)

  return {
    ok: true,
    warnings,
    record: {
      externalRowId: clip(input.externalRowId ?? input.row_id, 80),
      county,
      state,
      status,
      noticeLifecycle,
      sourceName: clip(input.sourceName ?? input.source_name, 120),
      sourceUrl: clip(input.sourceUrl ?? input.source_url, 400),
      sourceLayer: clip(input.sourceLayer ?? input.layer, 40),
      pullDate: parseIsoDate(input.pullDate ?? input.pull_date),
      noticeOrFilingDate: parseIsoDate(input.noticeOrFilingDate ?? input.notice_or_filing_date),
      saleDate: parseIsoDate(input.saleDate ?? input.sale_date),
      saleTime: clip(input.saleTime ?? input.sale_time, 40),
      saleLocation: clip(input.saleLocation ?? input.sale_location, 200),
      caseNumber: clip(input.caseNumber ?? input.case_number, 80),
      instrumentNumber: clip(input.instrumentNumber ?? input.instrument_number, 80),
      bookPage: clip(input.bookPage ?? input.book_page, 80),
      docType: clip(input.docType ?? input.doc_type, 80),
      ownerName,
      ownerEntity,
      plaintiffLender: clip(input.plaintiffLender ?? input.plaintiff_lender, 160),
      trusteeOrFirm: clip(input.trusteeOrFirm ?? input.trustee_or_firm, 160),
      situs,
      city: clip(input.city, 80),
      zip: clip(input.zip, 10),
      legalDescription: clip(input.legalDescription ?? input.legal_description, 1000),
      parcelId: clip(input.parcelId ?? input.parcel_id, 80),
      openingBid: parseMoney(input.openingBid ?? input.appraised_or_opening_bid),
      minBid: parseMoney(input.minBid ?? input.min_bid),
      amountClaimed: parseMoney(input.amountClaimed ?? input.amount_claimed),
      notes: clip(input.notes, 2000),
      recorderConfirmed: parseFlag(input.recorderConfirmed ?? input.recorder_confirmed_yn),
      courtConfirmed: parseFlag(input.courtConfirmed ?? input.court_confirmed_yn),
      estValue,
      estValueSource: clip(input.estValueSource ?? input.est_value_source, 80),
      estDebt,
      estDebtSource: clip(input.estDebtSource ?? input.est_debt_source, 80),
      estEquity: equity.estEquity,
      equityBand: equity.band,
      preferable: preferableEquity(estValue, equity.estEquity),
      skiptraceVendor: facts.skiptraceVendor,
      skiptraceDate,
      skiptraceBatchId,
      phones,
      email: clip(input.email ?? input.email_1, 160),
      deceased,
      skiptraceNotes,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
      noticesSent: outreach.count,
      outreachCount: outreach.count,
      attorneyName: clip(input.attorneyName ?? input.attorney_name ?? input.attorney, 160),
      saleStatus: parseSaleStatus(input.saleStatus ?? input.sale_status, noticeLifecycle),
      noticeType,
      noticeTypeSource: noticeType ? noticeTypeSource : null,
      noticeTimeline: parseNoticeTimeline(input.noticeTimeline ?? input.notice_timeline),
      absentee: absentee.absentee,
      ownerSignals: [
        ...nameSignals,
        ...absentee.signals.filter((signal) => signal === 'mailing_differs' || signal === 'out_of_state'),
      ],
      mailingAddress,
    },
  }
}

function parseCoordinate(raw: unknown, kind: 'lat' | 'lng'): number | null {
  if (raw == null || raw === '') return null
  const value = typeof raw === 'number' ? raw : Number(text(raw))
  if (!Number.isFinite(value)) return null
  const limit = kind === 'lat' ? 90 : 180
  if (Math.abs(value) > limit) return null
  return Math.round(value * 1_000_000) / 1_000_000
}

export function parseForeclosureCsv(csv: string): ForeclosureCsvResult {
  const table = parseForeclosureCsvTable(csv)
  if (table.length < 2) return { accepted: [], rejected: [], warnings: [] }
  const headers = table[0].map((header) => header.trim().toLowerCase())
  const accepted: NormalizedForeclosure[] = []
  const rejected: Array<{ row: number; reason: string }> = []
  const warnings: Array<{ row: number; message: string }> = []

  for (let index = 1; index < table.length; index += 1) {
    if (accepted.length >= FORECLOSURE_IMPORT_LIMIT) {
      rejected.push({ row: index + 1, reason: `Import stops at ${FORECLOSURE_IMPORT_LIMIT} rows.` })
      continue
    }
    const record: Record<string, unknown> = {}
    headers.forEach((header, column) => {
      if (header) record[header] = table[index][column] ?? ''
    })
    const normalized = normalizeForeclosureInput(record)
    if (!normalized.ok) {
      rejected.push({ row: index + 1, reason: normalized.reason })
      continue
    }
    accepted.push(normalized.record)
    for (const message of normalized.warnings) warnings.push({ row: index + 1, message })
  }
  return { accepted, rejected, warnings }
}

export function assertForeclosureStatusChange(current: ForeclosureStatus, next: ForeclosureStatus, dialReady: boolean): string | null {
  if (current === next) return null
  if (next === 'dnc' || next === 'dead') return null
  if (next === 'contacted' && (current === 'callable' || current === 'skip_traced')) return null
  if (next === 'callable' && dialReady) return null
  return 'That status change does not match the foreclosure lifecycle.'
}

function parseNoticeLifecycle(raw: unknown): ForeclosureNoticeLifecycle {
  const value = text(raw)?.toLowerCase().replace(/[\s-]+/g, '_') ?? ''
  if ((FORECLOSURE_NOTICE_LIFECYCLES as readonly string[]).includes(value)) return value as ForeclosureNoticeLifecycle
  if (value.includes('cancel')) return 'cancelled'
  if (value.includes('reinstate')) return 'reinstated'
  if (value.includes('schedul') || value.includes('sale')) return 'scheduled_sale'
  if (value.includes('confirm')) return 'confirmed'
  if (value.includes('notice') || value.includes('filing')) return 'notice'
  return 'unknown'
}

function isTaxRecord(input: Record<string, unknown>): boolean {
  if (parseFlag(input.taxOrDltFlag ?? input.tax_or_dlt_flag)) return true
  const blob = `${text(input.excludeReason ?? input.exclude_reason) ?? ''} ${text(input.docType ?? input.doc_type) ?? ''}`.toLowerCase()
  return /\b(tax sale|delinquent tax|tax deed|certificate of purchase|\bdlt\b)\b/.test(blob)
}

function text(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  return value || null
}

function clip(raw: unknown, max: number): string | null {
  const value = text(raw)
  return value ? value.slice(0, max) : null
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}
