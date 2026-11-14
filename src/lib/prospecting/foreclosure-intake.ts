import {
  type ForeclosureNoticeLifecycle,
  type ForeclosureNoticeType,
  type IngestControl,
  type SaleStatus,
  FORECLOSURE_NOTICE_TYPES,
  inferState,
  isSandboxForeclosureAddress,
  mergeIngestControls,
  normalizeCounty,
  parseIsoDate,
  parseNoticeType,
} from '@/lib/prospecting/foreclosure'
import { parseForeclosureCsvTable } from '@/lib/prospecting/foreclosure-csv'

export const FORECLOSURE_INTAKE_BATCH_LIMIT = 500
export const INTAKE_CONTROL_COUNTIES = ['jackson', 'clay', 'platte', 'johnson', 'wyandotte'] as const
export const KS_LICENSE_BLOCK = 'ks_license_unconfirmed'

const STREET_SUFFIX: Record<string, string> = {
  street: 'st', st: 'st', avenue: 'ave', ave: 'ave', road: 'rd', rd: 'rd',
  drive: 'dr', dr: 'dr', boulevard: 'blvd', blvd: 'blvd', lane: 'ln', ln: 'ln',
  court: 'ct', ct: 'ct', place: 'pl', pl: 'pl', terrace: 'ter', ter: 'ter',
  trail: 'trl', trl: 'trl', parkway: 'pkwy', pkwy: 'pkwy', circle: 'cir', cir: 'cir',
  highway: 'hwy', hwy: 'hwy',
}

const DIRECTION: Record<string, string> = {
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
}

export interface IntakeSourceDefinition {
  key: string
  displayName: string
  isPaid: boolean
  /** Seed default only. The database enabled flag is the runtime switch. */
  enabledByDefault: boolean
  priceNote: string | null
  aliases: readonly string[]
  defaultNoticeType: ForeclosureNoticeType
  /** Case.net is the only source that confirms a court filing. */
  courtConfirmed: boolean | null
}

/**
 * Source registry. Free feeds start enabled. Paid feeds are present and off.
 * Nothing here calls a paid API. Enabling a paid source is a config change
 * on mortgage_foreclosure_intake_sources.
 */
export const FORECLOSURE_INTAKE_SOURCES: readonly IntakeSourceDefinition[] = [
  { key: 'casenet', displayName: 'Case.net', isPaid: false, enabledByDefault: true, priceNote: null, aliases: ['casenet', 'case.net', 'case net'], defaultNoticeType: 'lis_pendens', courtConfirmed: true },
  { key: 'daily_record', displayName: 'Daily Record public notices', isPaid: false, enabledByDefault: true, priceNote: null, aliases: ['daily record', 'dailyrecord', 'daily record public notices'], defaultNoticeType: 'notice_of_sale', courtConfirmed: null },
  { key: 'noticeregistry', displayName: 'NoticeRegistry', isPaid: false, enabledByDefault: true, priceNote: null, aliases: ['noticeregistry', 'notice registry'], defaultNoticeType: 'notice_of_sale', courtConfirmed: null },
  { key: 'southlaw', displayName: 'SouthLaw', isPaid: false, enabledByDefault: true, priceNote: null, aliases: ['southlaw', 'south law'], defaultNoticeType: 'notice_of_sale', courtConfirmed: null },
  { key: 'millsap_singer', displayName: 'Millsap & Singer', isPaid: false, enabledByDefault: true, priceNote: null, aliases: ['millsap', 'millsap & singer', 'millsap and singer', 'millsap singer'], defaultNoticeType: 'notice_of_sale', courtConfirmed: null },
  { key: 'logs_missouri', displayName: 'LOGS Missouri trustee lists', isPaid: false, enabledByDefault: true, priceNote: null, aliases: ['logs', 'logs missouri', 'logs legal', 'logs missouri trustee'], defaultNoticeType: 'notice_of_sale', courtConfirmed: null },
  { key: 'ks_efiling', displayName: 'KS e-filing', isPaid: false, enabledByDefault: true, priceNote: null, aliases: ['ks e-filing', 'ks efiling', 'kansas e-filing', 'kansas efiling', 'kansas new civil filings', 'ks civil filings', 'ks new civil filings'], defaultNoticeType: 'lis_pendens', courtConfirmed: null },
  { key: 'ks_sheriff_lists', displayName: 'Johnson and Wyandotte sheriff lists', isPaid: false, enabledByDefault: true, priceNote: null, aliases: ['johnson sheriff', 'wyandotte sheriff', 'sheriff sale list', 'sheriff sale lists', 'ks sheriff', 'johnson county sheriff', 'wyandotte county sheriff'], defaultNoticeType: 'sheriff_sale', courtConfirmed: null },
  { key: 'mopublicnotices_smart_search', displayName: 'mopublicnotices Smart Search', isPaid: true, enabledByDefault: false, priceNote: '$75/30 days', aliases: ['mopublicnotices', 'mo public notices', 'mopublicnotices smart search', 'mo public notices smart search'], defaultNoticeType: 'notice_of_sale', courtConfirmed: null },
  { key: 'mlm_foreclosure_property_plus', displayName: 'Missouri Lawyers Media Foreclosure Property Plus', isPaid: true, enabledByDefault: false, priceNote: null, aliases: ['missouri lawyers media', 'foreclosure property plus', 'mlm foreclosure property plus'], defaultNoticeType: 'notice_of_sale', courtConfirmed: null },
  { key: 'trusteesaledata_pro', displayName: 'TrusteeSaleData Pro', isPaid: true, enabledByDefault: false, priceNote: null, aliases: ['trusteesaledata', 'trusteesaledata pro', 'trustee sale data', 'trustee sale data pro'], defaultNoticeType: 'notice_of_sale', courtConfirmed: null },
  { key: 'propertyradar', displayName: 'PropertyRadar', isPaid: true, enabledByDefault: false, priceNote: null, aliases: ['propertyradar', 'property radar'], defaultNoticeType: 'notice_of_sale', courtConfirmed: null },
]

export interface IntakeTimelineEvent {
  date: string | null
  source: string | null
  stage: string | null
  sale_date: string | null
  url: string | null
}

export interface PreparedIntake {
  sourceKey: string
  sourceName: string
  sourceUrl: string | null
  pullDate: string | null
  county: string
  state: string | null
  noticeType: ForeclosureNoticeType
  caseNumber: string | null
  instrumentNumber: string | null
  filingOrNoticeDate: string | null
  saleDate: string | null
  propertyAddress: string | null
  ownerName: string | null
  trusteeOrFirm: string | null
  stage: string | null
  parcelId: string | null
  zip: string | null
  addressKey: string | null
  ownerKey: string | null
  trusteeKey: string | null
  noticeKey: string | null
  noticeLifecycle: ForeclosureNoticeLifecycle | null
  saleStatus: SaleStatus | null
  courtConfirmed: boolean | null
  recorderConfirmed: null
  equityBand: null
  raw: Record<string, unknown>
}

export type IntakeMatchTier = 'parcel_id' | 'address_zip' | 'owner_trustee_sale' | 'case_or_notice'

export interface IntakeMatchCandidate {
  id: string
  kind: 'intake' | 'filing'
  parcelId: string | null
  addressKey: string | null
  zip: string | null
  ownerKey: string | null
  trusteeKey: string | null
  saleDate: string | null
  noticeKey: string | null
  ownerName: string | null
  situs: string | null
  timeline: IntakeTimelineEvent[]
  sourceName: string | null
  stage: string | null
  sourceUrl: string | null
  reviewStatus?: 'pending' | 'approved' | 'rejected'
}

const TIER_RANK: Record<IntakeMatchTier, number> = {
  parcel_id: 0,
  address_zip: 1,
  owner_trustee_sale: 2,
  case_or_notice: 3,
}

export interface IntakeReviewRow {
  id: string
  demo?: boolean
  sourceName: string
  sourceUrl: string | null
  timeline: IntakeTimelineEvent[]
  saleDate: string | null
  county: string
  state: string | null
  ownerName: string | null
  trusteeOrFirm: string | null
  equityBand: string | null
  reviewStatus: 'pending' | 'approved' | 'rejected'
}

export function sourceToken(raw: unknown): string {
  return text(raw)?.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim() ?? ''
}

export function matchIntakeSourceDefinition(raw: unknown): IntakeSourceDefinition | null {
  const token = sourceToken(raw)
  if (!token) return null
  return FORECLOSURE_INTAKE_SOURCES.find((source) => source.aliases.some((alias) => sourceToken(alias) === token)) ?? null
}

/** A missing registry row is off. Paid feeds stay off until enabled is stored true. */
export function intakeSourceAcceptsRows(source: { enabled: boolean } | null | undefined): boolean {
  return source?.enabled === true
}

/** A missing county and notice-type control is paused. */
export function automaticLoadAllowed(control: { paused: boolean } | null | undefined): boolean {
  return control?.paused === false
}

export function presentIngestControls(stored: IngestControl[]): IngestControl[] {
  const keys = new Set(stored.map((row) => `${row.county}:${row.noticeType}`))
  return mergeIngestControls(stored, INTAKE_CONTROL_COUNTIES).map((row) => (
    keys.has(`${row.county}:${row.noticeType}`) ? row : { ...row, paused: true }
  ))
}

export function normalizeParcelId(raw: unknown): string | null {
  const value = text(raw)?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? ''
  return value || null
}

export function normalizeNoticeKey(raw: unknown): string | null {
  const value = text(raw)?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? ''
  return value || null
}

export function normalizePartyName(raw: unknown): string | null {
  const original = text(raw)
  if (!original) return null
  const comma = original.split(',')
  let ordered = original
  if (comma.length > 1) {
    const right = comma.slice(1).join(' ').trim()
    const rightToken = right.toLowerCase().replace(/[^a-z0-9]/g, '')
    const entitySuffix = /^(llc|l\.?l\.?c|inc|corp|lp|llp|pllc|pc|co|company|ltd)$/.test(rightToken)
    ordered = entitySuffix ? `${comma[0]} ${right}` : `${right} ${comma[0]}`
  }
  const value = ordered
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return value || null
}

export function normalizeStreetAddress(raw: unknown): string | null {
  const original = text(raw)
  if (!original) return null
  const line = (original.split(',')[0] ?? original)
    .toLowerCase()
    .replace(/[#.]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!line) return null
  return line.split(' ').map((part) => STREET_SUFFIX[part] ?? DIRECTION[part] ?? part).join(' ')
}

export function extractZip(address: unknown, explicit?: unknown): string | null {
  const given = text(explicit)?.match(/\d{5}/)?.[0]
  if (given) return given
  const matches = text(address)?.match(/\b\d{5}(?:-\d{4})?\b/g)
  return matches?.at(-1)?.slice(0, 5) ?? null
}

export function noticeTypeForIntake(source: IntakeSourceDefinition, stage: string | null): ForeclosureNoticeType {
  return parseNoticeType(stage) ?? source.defaultNoticeType
}

function lifecycleFromStage(stage: string | null, saleDate: string | null): ForeclosureNoticeLifecycle | null {
  const value = stage?.toLowerCase() ?? ''
  if (!value && !saleDate) return null
  if (value.includes('cancel')) return 'cancelled'
  if (value.includes('reinstate')) return 'reinstated'
  if (/\bsold\b/.test(value)) return 'sold'
  if (value.includes('confirm') && !value.includes('unconfirm')) return 'confirmed'
  if (value.includes('notice') || value.includes('lis') || value.includes('filing') || value.includes('petition') || value.includes('nod')) {
    return saleDate ? 'scheduled_sale' : 'notice'
  }
  if (saleDate) return 'scheduled_sale'
  return null
}

function saleStatusFromStage(stage: string | null, saleDate: string | null): SaleStatus | null {
  const value = stage?.toLowerCase() ?? ''
  if (value.includes('postpone') || value.includes('continu')) return 'postponed'
  if (value.includes('cancel')) return 'cancelled'
  if (value.includes('reinstate')) return 'reinstated'
  if (/\bsold\b/.test(value)) return 'sold'
  if (saleDate || value.includes('schedul') || value.includes('sheriff') || value.includes('sale')) return saleDate ? 'scheduled' : null
  return null
}

/**
 * EQUITY ENRICHMENT HOOK — later phase.
 * Do not call a valuation vendor, PropertyRadar, or any other paid feed here.
 * The hook stays in the pipeline so a later phase can return a band.
 * Until then it returns null and the intake row stores null.
 */
export function equityEnrichmentHook(input: {
  parcelId: string | null
  propertyAddress: string | null
  zip: string | null
}): { equityBand: null } {
  void input
  return { equityBand: null }
}

export function isProtectedSandboxFiling(row: { ownerName?: string | null; situs?: string | null; propertyAddress?: string | null }): boolean {
  const address = row.situs ?? row.propertyAddress
  if (isSandboxForeclosureAddress(address)) return true
  return (row.ownerName ?? '').trim().toLowerCase() === 'ernest dodson'
}

export function prepareIntakeRow(
  input: Record<string, unknown>,
  sourceRow: { enabled: boolean } | null,
  control: { paused: boolean } | null,
  pullDate: string | null,
): { ok: true; record: PreparedIntake } | { ok: false; code: string; reason: string } {
  const definition = matchIntakeSourceDefinition(input.source ?? input.source_name)
  if (!definition) return { ok: false, code: 'unknown_source', reason: 'That source is not in the foreclosure intake registry.' }
  if (!sourceRow || !intakeSourceAcceptsRows(sourceRow)) {
    const price = definition.priceNote ? ` (${definition.priceNote})` : ''
    const paid = definition.isPaid ? ` Paid source${price} stays off until its enabled flag is changed.` : ''
    return { ok: false, code: 'source_disabled', reason: `${definition.displayName} is turned off.${paid}` }
  }
  const county = normalizeCounty(input.county)
  if (!county) return { ok: false, code: 'county_required', reason: 'County is required. A missing county stays paused.' }
  const stage = clip(input.stage, 160)
  const noticeType = noticeTypeForIntake(definition, stage)
  if (!(FORECLOSURE_NOTICE_TYPES as readonly string[]).includes(noticeType)) {
    return { ok: false, code: 'notice_type_unresolved', reason: 'Notice type could not be read, so the row stays paused.' }
  }
  if (!automaticLoadAllowed(control)) {
    return { ok: false, code: 'ingest_paused', reason: `Automatic loading is paused for ${county} ${noticeType.replaceAll('_', ' ')}.` }
  }
  const state = inferState(county, input.state)
  const address = clip(input.property_address ?? input.propertyAddress, 300)
  const owner = clip(input.owner_or_defendant ?? input.ownerName, 200)
  const party = clip(input.plaintiff_or_trustee_firm ?? input.trusteeOrFirm, 200)
  const noticeId = clip(input.case_number_or_notice_id ?? input.caseNumber ?? input.instrumentNumber, 80)
  const filingDate = parseIsoDate(input.filing_or_notice_date ?? input.filingOrNoticeDate)
  const saleDate = parseIsoDate(input.sale_date ?? input.saleDate)
  const parcelId = normalizeParcelId(input.parcel_id ?? input.parcelId)
  const zip = extractZip(address, input.zip)
  const court = definition.courtConfirmed === true ? true : null
  const equity = equityEnrichmentHook({ parcelId, propertyAddress: address, zip })
  const courtCase = definition.key === 'casenet' || definition.key === 'ks_efiling'
  return {
    ok: true,
    record: {
      sourceKey: definition.key,
      sourceName: definition.displayName,
      sourceUrl: clip(input.source_url ?? input.sourceUrl, 400),
      pullDate: parseIsoDate(pullDate) ?? parseIsoDate(input.pull_date ?? input.pullDate),
      county,
      state,
      noticeType,
      caseNumber: courtCase ? noticeId : null,
      instrumentNumber: courtCase ? null : noticeId,
      filingOrNoticeDate: filingDate,
      saleDate,
      propertyAddress: address,
      ownerName: owner,
      trusteeOrFirm: party,
      stage,
      parcelId,
      zip,
      addressKey: normalizeStreetAddress(address),
      ownerKey: normalizePartyName(owner),
      trusteeKey: normalizePartyName(party),
      noticeKey: normalizeNoticeKey(noticeId),
      noticeLifecycle: lifecycleFromStage(stage, saleDate),
      saleStatus: saleStatusFromStage(stage, saleDate),
      courtConfirmed: court,
      recorderConfirmed: null,
      equityBand: equity.equityBand,
      raw: input,
    },
  }
}

export function openingTimeline(record: Pick<PreparedIntake, 'filingOrNoticeDate' | 'pullDate' | 'sourceName' | 'stage' | 'saleDate' | 'sourceUrl'>): IntakeTimelineEvent[] {
  return [{
    date: record.filingOrNoticeDate ?? record.pullDate,
    source: record.sourceName,
    stage: record.stage,
    sale_date: record.saleDate,
    url: record.sourceUrl,
  }]
}

export function sameTimelineEvent(left: IntakeTimelineEvent, right: IntakeTimelineEvent): boolean {
  return left.date === right.date
    && left.source === right.source
    && left.stage === right.stage
    && left.sale_date === right.sale_date
    && left.url === right.url
}

export function appendIntakeNotice(
  existing: {
    timeline: IntakeTimelineEvent[]
    saleDate: string | null
    sourceName: string | null
    stage: string | null
    sourceUrl: string | null
  },
  incoming: { date: string | null; source: string | null; stage: string | null; saleDate: string | null; url: string | null },
): { timeline: IntakeTimelineEvent[]; saleDate: string | null; republished: boolean; duplicate: boolean } {
  const event: IntakeTimelineEvent = {
    date: incoming.date,
    source: incoming.source,
    stage: incoming.stage,
    sale_date: incoming.saleDate,
    url: incoming.url,
  }
  const timeline = existing.timeline.filter(isTimelineEvent)
  if (timeline.some((item) => sameTimelineEvent(item, event))) {
    return { timeline, saleDate: existing.saleDate, republished: false, duplicate: true }
  }
  const next = [...timeline]
  if (existing.saleDate && incoming.saleDate && existing.saleDate !== incoming.saleDate && !next.some((item) => item.sale_date === existing.saleDate)) {
    next.push({
      date: null,
      source: existing.sourceName,
      stage: existing.stage,
      sale_date: existing.saleDate,
      url: existing.sourceUrl,
    })
  }
  next.push(event)
  return {
    timeline: next.slice(-50),
    saleDate: incoming.saleDate ?? existing.saleDate,
    republished: Boolean(incoming.saleDate && existing.saleDate && incoming.saleDate !== existing.saleDate),
    duplicate: false,
  }
}

export function matchTier(incoming: PreparedIntake, candidate: IntakeMatchCandidate): IntakeMatchTier | null {
  if (candidate.kind === 'filing' && isProtectedSandboxFiling({ ownerName: candidate.ownerName, situs: candidate.situs })) return null
  if (incoming.parcelId && candidate.parcelId && incoming.parcelId !== candidate.parcelId) return null
  if (incoming.parcelId && candidate.parcelId && incoming.parcelId === candidate.parcelId) return 'parcel_id'
  if (incoming.addressKey && incoming.zip && incoming.addressKey === candidate.addressKey && incoming.zip === candidate.zip) return 'address_zip'
  if (
    incoming.ownerKey && incoming.trusteeKey && incoming.saleDate
    && incoming.ownerKey === candidate.ownerKey
    && incoming.trusteeKey === candidate.trusteeKey
    && incoming.saleDate === candidate.saleDate
  ) return 'owner_trustee_sale'
  if (incoming.noticeKey && candidate.noticeKey && incoming.noticeKey === candidate.noticeKey) return 'case_or_notice'
  return null
}

export function bestIntakeMatch(
  incoming: PreparedIntake,
  candidates: readonly IntakeMatchCandidate[],
): { candidate: IntakeMatchCandidate; tier: IntakeMatchTier } | null {
  let best: { candidate: IntakeMatchCandidate; tier: IntakeMatchTier; rank: number } | null = null
  for (const candidate of candidates) {
    const tier = matchTier(incoming, candidate)
    if (!tier) continue
    const rank = TIER_RANK[tier]
    const preferIntake = rank === best?.rank && candidate.kind === 'intake' && best.candidate.kind !== 'intake'
    if (!best || rank < best.rank || preferIntake) best = { candidate, tier, rank }
  }
  return best ? { candidate: best.candidate, tier: best.tier } : null
}

export type IntakeReviewStatus = 'pending' | 'approved' | 'rejected'

/** Pending and rejected rows never reach skip trace, export, or a dialer. */
export function foreclosureIntakeOutreachBlockers(input: {
  reviewStatus: IntakeReviewStatus
  state: string | null
  county: string | null
  dnc: boolean
  optedOut: boolean
  ksLicenseConfirmed: boolean | null
}): string[] {
  const blockers: string[] = []
  if (input.reviewStatus !== 'approved') blockers.push('intake_not_approved')
  if (input.dnc) blockers.push('do_not_call')
  if (input.optedOut) blockers.push('sms_opt_out')
  const kansas = (input.state ?? '').toUpperCase() === 'KS' || input.county === 'johnson' || input.county === 'wyandotte'
  if (kansas && input.ksLicenseConfirmed !== true) blockers.push(KS_LICENSE_BLOCK)
  return blockers
}

export function intakeRowsReachableForDialerOrExport<T extends {
  reviewStatus: IntakeReviewStatus
  state: string | null
  county: string | null
  dnc: boolean
  optedOut: boolean
  ksLicenseConfirmed: boolean | null
}>(rows: readonly T[]): T[] {
  return rows.filter((row) => foreclosureIntakeOutreachBlockers(row).length === 0)
}

export function parseIntakeBatch(body: unknown): { pullDate: string | null; rows: Record<string, unknown>[]; truncated: boolean } | { error: string } {
  if (typeof body === 'string') return rowsFromCsv(body, null)
  if (Array.isArray(body)) return capRows(null, body.filter(isRecord))
  if (!isRecord(body)) return { error: 'Intake body must be a batch of rows.' }
  const pullDate = text(body.pull_date ?? body.pullDate)
  if (typeof body.csv === 'string') return rowsFromCsv(body.csv, pullDate)
  const rows = Array.isArray(body.rows) ? body.rows.filter(isRecord) : null
  if (!rows) return { error: 'Intake body needs a rows array in the foreclosure CSV shape.' }
  return capRows(pullDate, rows)
}

export function foreclosureIntakeReviewFixtures(): IntakeReviewRow[] {
  return [
    {
      id: 'f7220000-0000-4000-8000-0000000000a1',
      demo: true,
      sourceName: 'Case.net',
      sourceUrl: 'https://example.com/casenet/sandbox-notice',
      timeline: [{ date: '2026-11-01', source: 'Case.net', stage: 'Lis Pendens', sale_date: null, url: 'https://example.com/casenet/sandbox-notice' }],
      saleDate: null,
      county: 'jackson',
      state: 'MO',
      ownerName: 'Sample Homeowner',
      trusteeOrFirm: 'Sample Trustee',
      equityBand: null,
      reviewStatus: 'pending',
    },
    {
      id: 'f7220000-0000-4000-8000-0000000000a2',
      demo: true,
      sourceName: 'Johnson and Wyandotte sheriff lists',
      sourceUrl: 'https://example.com/sheriff/sandbox-sale',
      timeline: [
        { date: '2026-10-01', source: 'Johnson and Wyandotte sheriff lists', stage: 'Sheriff sale', sale_date: '2026-11-20', url: 'https://example.com/sheriff/sandbox-sale' },
        { date: '2026-11-02', source: 'Johnson and Wyandotte sheriff lists', stage: 'Sheriff sale', sale_date: '2026-12-04', url: 'https://example.com/sheriff/sandbox-sale' },
      ],
      saleDate: '2026-12-04',
      county: 'johnson',
      state: 'KS',
      ownerName: 'Sample Defendant',
      trusteeOrFirm: 'Sample Sheriff',
      equityBand: null,
      reviewStatus: 'pending',
    },
  ]
}

function rowsFromCsv(csv: string, pullDate: string | null): { pullDate: string | null; rows: Record<string, unknown>[]; truncated: boolean } | { error: string } {
  const table = parseForeclosureCsvTable(csv)
  if (table.length < 2) return { error: 'The CSV needs a header and at least one row.' }
  const headers = table[0].map((header) => header.trim().toLowerCase())
  const rows = table.slice(1).map((cells) => {
    const record: Record<string, unknown> = {}
    headers.forEach((header, index) => {
      if (header) record[header] = cells[index] ?? ''
    })
    return record
  })
  return capRows(pullDate, rows)
}

function capRows(pullDate: string | null, rows: Record<string, unknown>[]): { pullDate: string | null; rows: Record<string, unknown>[]; truncated: boolean } {
  return {
    pullDate,
    rows: rows.slice(0, FORECLOSURE_INTAKE_BATCH_LIMIT),
    truncated: rows.length > FORECLOSURE_INTAKE_BATCH_LIMIT,
  }
}

function isTimelineEvent(value: unknown): value is IntakeTimelineEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  return 'sale_date' in event || 'source' in event
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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
