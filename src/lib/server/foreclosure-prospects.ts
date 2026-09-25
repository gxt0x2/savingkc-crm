import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import { phoneLookupVariants } from '@/lib/dialer-call-policy'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import {
  type ForeclosureStatus,
  type NormalizedForeclosure,
  FORECLOSURE_STATUSES,
  assertForeclosureStatusChange,
  chicagoDate,
  compareForeclosureQueue,
  dialReadyBlockers,
  foreclosureCallingHref,
  normalizeForeclosureInput,
  parseForeclosureCsv,
  saleWithinWeek,
} from '@/lib/prospecting/foreclosure'
import { supabase } from '@/lib/supabase-lazy'

export class ForeclosureError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message)
  }
}

export interface ForeclosureView {
  id: string
  externalRowId: string | null
  county: string
  state: string
  status: ForeclosureStatus
  noticeLifecycle: string
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
  ownerName: string
  ownerEntity: string
  plaintiffLender: string | null
  trusteeOrFirm: string | null
  situs: string
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
  equityBand: string
  preferable: boolean
  priority: boolean
  skiptraceVendor: 'smartskip' | null
  skiptraceDate: string | null
  skiptraceBatchId: string | null
  phones: string[]
  email: string | null
  deceased: boolean
  skiptraceNotes: string | null
  prospectId: string | null
  leadId: string | null
  dialReady: boolean
  dialBlockers: string[]
  latitude: number | null
  longitude: number | null
  noticesSent: number
  updatedAt: string
}

interface ForeclosureRow {
  id: string
  external_row_id: string | null
  county: string
  state: string
  status: ForeclosureStatus
  notice_lifecycle: string
  source_name: string | null
  source_url: string | null
  source_layer: string | null
  pull_date: string | null
  notice_or_filing_date: string | null
  sale_date: string | null
  sale_time: string | null
  sale_location: string | null
  case_number: string | null
  instrument_number: string | null
  book_page: string | null
  doc_type: string | null
  owner_name: string
  owner_entity: NormalizedForeclosure['ownerEntity']
  plaintiff_lender: string | null
  trustee_or_firm: string | null
  situs: string
  city: string | null
  zip: string | null
  legal_description: string | null
  parcel_id: string | null
  opening_bid: number | null
  min_bid: number | null
  amount_claimed: number | null
  notes: string | null
  recorder_confirmed: boolean
  court_confirmed: boolean
  est_value: number | null
  est_value_source: string | null
  est_debt: number | null
  est_debt_source: string | null
  est_equity: number | null
  equity_band: string
  preferable: boolean
  skiptrace_vendor: 'smartskip' | null
  skiptrace_date: string | null
  skiptrace_batch_id: string | null
  phone_1: string | null
  phone_2: string | null
  phone_3: string | null
  email_1: string | null
  deceased_flag: boolean
  skiptrace_notes: string | null
  prospect_id: string | null
  lead_id: string | null
  latitude: number | string | null
  longitude: number | string | null
  notices_sent: number | string | null
  updated_at: string
}

const TABLE = 'mortgage_foreclosure_prospects'

function databaseError(error: { message?: string; code?: string } | null | undefined): ForeclosureError {
  const detail = `${error?.message || ''} ${error?.code || ''}`.toLowerCase()
  if (detail.includes('42p01') || detail.includes('does not exist') || detail.includes('pgrst205')) {
    return new ForeclosureError('foreclosure_unavailable', 503, 'Foreclosure storage is not available in this environment yet.')
  }
  if (detail.includes('23505')) return new ForeclosureError('duplicate_row', 409, 'That foreclosure row id is already imported.')
  if (detail.includes('23514') || detail.includes('22p02')) return new ForeclosureError('invalid_foreclosure', 400, 'Foreclosure details are invalid.')
  console.error('[foreclosure] database error', { code: error?.code || 'unknown' })
  return new ForeclosureError('foreclosure_unavailable', 503, 'Foreclosure records could not be saved.')
}

function phonesOf(row: Pick<ForeclosureRow, 'phone_1' | 'phone_2' | 'phone_3'>): string[] {
  return [row.phone_1, row.phone_2, row.phone_3].filter((phone): phone is string => Boolean(phone))
}

function toView(row: ForeclosureRow): ForeclosureView {
  const phones = phonesOf(row)
  const dialBlockers = dialReadyBlockers({
    ownerEntity: row.owner_entity,
    deceased: row.deceased_flag,
    vendor: row.skiptrace_vendor,
    phones,
    estEquity: row.est_equity == null ? null : Number(row.est_equity),
    status: row.status,
  })
  return {
    id: row.id,
    externalRowId: row.external_row_id,
    county: row.county,
    state: row.state,
    status: row.status,
    noticeLifecycle: row.notice_lifecycle,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    sourceLayer: row.source_layer,
    pullDate: row.pull_date,
    noticeOrFilingDate: row.notice_or_filing_date,
    saleDate: row.sale_date,
    saleTime: row.sale_time,
    saleLocation: row.sale_location,
    caseNumber: row.case_number,
    instrumentNumber: row.instrument_number,
    bookPage: row.book_page,
    docType: row.doc_type,
    ownerName: row.owner_name,
    ownerEntity: row.owner_entity,
    plaintiffLender: row.plaintiff_lender,
    trusteeOrFirm: row.trustee_or_firm,
    situs: row.situs,
    city: row.city,
    zip: row.zip,
    legalDescription: row.legal_description,
    parcelId: row.parcel_id,
    openingBid: numberOrNull(row.opening_bid),
    minBid: numberOrNull(row.min_bid),
    amountClaimed: numberOrNull(row.amount_claimed),
    notes: row.notes,
    recorderConfirmed: row.recorder_confirmed,
    courtConfirmed: row.court_confirmed,
    estValue: numberOrNull(row.est_value),
    estValueSource: row.est_value_source,
    estDebt: numberOrNull(row.est_debt),
    estDebtSource: row.est_debt_source,
    estEquity: numberOrNull(row.est_equity),
    equityBand: row.equity_band,
    preferable: row.preferable,
    priority: numberOrNull(row.est_equity) != null && Number(row.est_equity) >= 100_000,
    skiptraceVendor: row.skiptrace_vendor,
    skiptraceDate: row.skiptrace_date,
    skiptraceBatchId: row.skiptrace_batch_id,
    phones,
    email: row.email_1,
    deceased: row.deceased_flag,
    skiptraceNotes: row.skiptrace_notes,
    prospectId: row.prospect_id,
    leadId: row.lead_id,
    latitude: numberOrNull(row.latitude),
    longitude: numberOrNull(row.longitude),
    noticesSent: countNotices(row.notices_sent),
    dialReady: dialBlockers.length === 0,
    dialBlockers,
    updatedAt: row.updated_at,
  }
}

function payload(record: NormalizedForeclosure, actor: AuthenticatedActor) {
  return {
    external_row_id: record.externalRowId,
    county: record.county,
    state: record.state,
    status: record.status,
    notice_lifecycle: record.noticeLifecycle,
    source_name: record.sourceName,
    source_url: record.sourceUrl,
    source_layer: record.sourceLayer,
    pull_date: record.pullDate,
    notice_or_filing_date: record.noticeOrFilingDate,
    sale_date: record.saleDate,
    sale_time: record.saleTime,
    sale_location: record.saleLocation,
    case_number: record.caseNumber,
    instrument_number: record.instrumentNumber,
    book_page: record.bookPage,
    doc_type: record.docType,
    owner_name: record.ownerName,
    owner_entity: record.ownerEntity,
    plaintiff_lender: record.plaintiffLender,
    trustee_or_firm: record.trusteeOrFirm,
    situs: record.situs,
    city: record.city,
    zip: record.zip,
    legal_description: record.legalDescription,
    parcel_id: record.parcelId,
    opening_bid: record.openingBid,
    min_bid: record.minBid,
    amount_claimed: record.amountClaimed,
    notes: record.notes,
    tax_or_dlt_flag: false,
    recorder_confirmed: record.recorderConfirmed,
    court_confirmed: record.courtConfirmed,
    est_value: record.estValue,
    est_value_source: record.estValueSource,
    est_debt: record.estDebt,
    est_debt_source: record.estDebtSource,
    est_equity: record.estEquity,
    equity_band: record.equityBand,
    preferable: record.preferable,
    skiptrace_vendor: record.skiptraceVendor,
    skiptrace_date: record.skiptraceDate,
    skiptrace_batch_id: record.skiptraceBatchId,
    phone_1: record.phones[0] ?? null,
    phone_2: record.phones[1] ?? null,
    phone_3: record.phones[2] ?? null,
    email_1: record.email,
    deceased_flag: record.deceased,
    skiptrace_notes: record.skiptraceNotes,
    latitude: record.latitude,
    longitude: record.longitude,
    notices_sent: record.noticesSent,
    updated_by: actor.email,
    updated_at: new Date().toISOString(),
  }
}

function requireNormalized(input: Record<string, unknown>, current: ForeclosureStatus = 'new'): NormalizedForeclosure {
  const normalized = normalizeForeclosureInput(input, current)
  if (!normalized.ok) throw new ForeclosureError('invalid_foreclosure', 400, normalized.reason)
  return normalized.record
}

export async function listForeclosureProspects(filters: { county?: string | null; status?: string | null; dialReady?: boolean; saleThisWeek?: boolean }) {
  let query = supabase.from(TABLE).select('*').order('sale_date', { ascending: true, nullsFirst: false }).limit(200)
  if (filters.county) query = query.eq('county', filters.county)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.dialReady) {
    query = query.eq('status', 'callable').eq('owner_entity', 'person').eq('deceased_flag', false).eq('skiptrace_vendor', 'smartskip').gte('est_equity', 75_000)
  }
  const { data, error } = await query
  if (error) throw databaseError(error)
  const today = chicagoDate()
  return ((data ?? []) as ForeclosureRow[])
    .map(toView)
    .filter((view) => !filters.saleThisWeek || saleWithinWeek(view.saleDate, today))
    .sort(compareForeclosureQueue)
}

export async function getForeclosureProspect(id: string) {
  assertId(id)
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle<ForeclosureRow>()
  if (error) throw databaseError(error)
  if (!data) throw new ForeclosureError('not_found', 404, 'Foreclosure prospect was not found.')
  return toView(data)
}

export async function createForeclosureProspect(actor: AuthenticatedActor, input: Record<string, unknown>) {
  const record = await placeCoordinates(requireNormalized(input))
  const { data, error } = await supabase.from(TABLE).insert({ ...payload(record, actor), created_by: actor.email }).select('*').single<ForeclosureRow>()
  if (error) throw databaseError(error)
  return toView(data)
}

export async function updateForeclosureProspect(actor: AuthenticatedActor, id: string, input: Record<string, unknown>) {
  assertId(id)
  const existing = await getForeclosureProspect(id)
  const merged = {
    ...viewToInput(existing),
    ...input,
  }
  const record = requireNormalized(merged, existing.status)
  const requested = typeof input.status === 'string' ? input.status : null
  if (requested) {
    if (!(FORECLOSURE_STATUSES as readonly string[]).includes(requested)) {
      throw new ForeclosureError('invalid_status', 400, 'That foreclosure status is not recognized.')
    }
    const next = requested as ForeclosureStatus
    const ready = dialReadyBlockers({
      ownerEntity: record.ownerEntity,
      deceased: record.deceased,
      vendor: record.skiptraceVendor,
      phones: record.phones,
      estEquity: record.estEquity,
      status: 'new',
    }).length === 0
    const statusError = assertForeclosureStatusChange(existing.status, next, ready)
    if (statusError) throw new ForeclosureError('invalid_status', 409, statusError)
    record.status = next
  }
  const { data, error } = await supabase.from(TABLE).update(payload(record, actor)).eq('id', id).select('*').single<ForeclosureRow>()
  if (error) throw databaseError(error)
  return toView(data)
}

export async function importForeclosureCsv(actor: AuthenticatedActor, csv: string) {
  if (csv.length > 1_000_000) throw new ForeclosureError('csv_too_large', 400, 'CSV imports are limited to 1 MB.')
  const parsed = parseForeclosureCsv(csv)
  if (parsed.accepted.length === 0 && parsed.rejected.length === 0) {
    throw new ForeclosureError('empty_csv', 400, 'The CSV has no data rows. Use the pilot header row.')
  }
  let imported = 0
  for (const record of parsed.accepted) {
    await upsertImported(actor, await placeCoordinates(record))
    imported += 1
  }
  return { imported, rejected: parsed.rejected, warnings: parsed.warnings }
}

export async function prepareForeclosureCall(actor: AuthenticatedActor, id: string) {
  assertId(id)
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle<ForeclosureRow>()
  if (error) throw databaseError(error)
  if (!data) throw new ForeclosureError('not_found', 404, 'Foreclosure prospect was not found.')
  const view = toView(data)
  if (!view.dialReady) {
    throw new ForeclosureError('not_dial_ready', 409, view.dialBlockers[0] || 'This foreclosure prospect is not ready to call.')
  }
  const optedOut = await firstOptedOutPhone(view.phones)
  if (optedOut) {
    await supabase.from(TABLE).update({ status: 'dnc', updated_by: actor.email, updated_at: new Date().toISOString() }).eq('id', id)
    throw new ForeclosureError('dnc', 409, 'Calling is blocked because this number is on the do-not-call list.')
  }
  const prospectId = await upsertDialProspect(data)
  const prospectPhoneId = await ensureOwnerPhone(prospectId, data)
  const { error: linkError } = await supabase.from(TABLE).update({
    prospect_id: prospectId,
    updated_by: actor.email,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (linkError) throw databaseError(linkError)
  return {
    prospectId,
    prospectPhoneId,
    phone: data.phone_1,
    href: foreclosureCallingHref(prospectId, id),
  }
}

async function upsertImported(actor: AuthenticatedActor, record: NormalizedForeclosure) {
  if (record.externalRowId) {
    const existing = await supabase.from(TABLE).select('id,status').eq('external_row_id', record.externalRowId).maybeSingle<{ id: string; status: ForeclosureStatus }>()
    if (existing.error) throw databaseError(existing.error)
    if (existing.data) {
      const status = ['contacted', 'dnc', 'dead'].includes(existing.data.status) ? existing.data.status : record.status
      const { error } = await supabase.from(TABLE).update({ ...payload({ ...record, status }, actor) }).eq('id', existing.data.id)
      if (error) throw databaseError(error)
      return
    }
  }
  const { error } = await supabase.from(TABLE).insert({ ...payload(record, actor), created_by: actor.email })
  if (error) throw databaseError(error)
}

async function upsertDialProspect(row: ForeclosureRow): Promise<string> {
  const dialPayload = {
    county: row.county,
    parcel_id: `mfc:${row.id}`,
    situs_address: row.situs,
    situs_street: row.situs,
    situs_city: row.city,
    situs_state: row.state,
    situs_zip: row.zip,
    owner_1: row.owner_name,
    owner_1_type: 'person',
    email_1: row.email_1,
    total_market_value: row.est_value,
    is_deceased: row.deceased_flag,
    is_skip_traced: true,
    prospect_track: 'mortgage_foreclosure',
    delinquent_years_category: null,
    lead_id: row.lead_id,
  }
  if (row.prospect_id) {
    const { error } = await supabase.from('prospects').update(dialPayload).eq('id', row.prospect_id)
    if (error) throw databaseError(error)
    return row.prospect_id
  }
  const { data, error } = await supabase.from('prospects').insert(dialPayload).select('id').single<{ id: string }>()
  if (error || !data) throw databaseError(error)
  return data.id
}

async function ensureOwnerPhone(prospectId: string, row: ForeclosureRow): Promise<string> {
  const phone = row.phone_1
  if (!phone) throw new ForeclosureError('not_dial_ready', 409, 'No SmartSkip phone is on file.')
  const existing = await supabase.from('prospect_phones').select('id,phone').eq('prospect_id', prospectId).limit(20)
  if (existing.error) throw databaseError(existing.error)
  const match = ((existing.data ?? []) as Array<{ id: string; phone: string | null }>).find((item) => normalizePhoneToE164(item.phone) === phone)
  if (match) return match.id
  const inserted = await supabase.from('prospect_phones').insert({
    prospect_id: prospectId,
    phone,
    phone_type: 'mobile',
    contact_name: row.owner_name,
    relationship: 'owner',
  }).select('id').single<{ id: string }>()
  if (inserted.error || !inserted.data) throw databaseError(inserted.error)
  return inserted.data.id
}

async function firstOptedOutPhone(phones: string[]): Promise<boolean> {
  const variants = phones.flatMap((phone) => phoneLookupVariants(phone))
  if (variants.length === 0) return false
  const { data, error } = await supabase.from('sms_opt_outs').select('phone').in('phone', variants).eq('is_opted_out', true).limit(1)
  if (error) throw databaseError(error)
  return (data ?? []).length > 0
}

function viewToInput(view: ForeclosureView): Record<string, unknown> {
  return {
    externalRowId: view.externalRowId,
    county: view.county,
    state: view.state,
    noticeLifecycle: view.noticeLifecycle,
    sourceName: view.sourceName,
    sourceUrl: view.sourceUrl,
    sourceLayer: view.sourceLayer,
    pullDate: view.pullDate,
    noticeOrFilingDate: view.noticeOrFilingDate,
    saleDate: view.saleDate,
    saleTime: view.saleTime,
    saleLocation: view.saleLocation,
    caseNumber: view.caseNumber,
    instrumentNumber: view.instrumentNumber,
    bookPage: view.bookPage,
    docType: view.docType,
    ownerName: view.ownerName,
    plaintiffLender: view.plaintiffLender,
    trusteeOrFirm: view.trusteeOrFirm,
    situs: view.situs,
    city: view.city,
    zip: view.zip,
    legalDescription: view.legalDescription,
    parcelId: view.parcelId,
    openingBid: view.openingBid,
    minBid: view.minBid,
    amountClaimed: view.amountClaimed,
    notes: view.notes,
    recorderConfirmed: view.recorderConfirmed,
    courtConfirmed: view.courtConfirmed,
    estValue: view.estValue,
    estValueSource: view.estValueSource,
    estDebt: view.estDebt,
    estDebtSource: view.estDebtSource,
    skiptraceVendor: view.skiptraceVendor,
    skiptraceDate: view.skiptraceDate,
    skiptraceBatchId: view.skiptraceBatchId,
    phone1: view.phones[0],
    phone2: view.phones[1],
    phone3: view.phones[2],
    email: view.email,
    deceased: view.deceased,
    skiptraceNotes: view.skiptraceNotes,
    latitude: view.latitude,
    longitude: view.longitude,
    noticesSent: view.noticesSent,
  }
}

async function placeCoordinates(record: NormalizedForeclosure): Promise<NormalizedForeclosure> {
  if (record.latitude != null && record.longitude != null) return record
  const geocoded = await geocodeForeclosureAddress(record)
  return geocoded ? { ...record, ...geocoded } : record
}

async function geocodeForeclosureAddress(record: NormalizedForeclosure): Promise<{ latitude: number; longitude: number } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim()
  if (!key || !record.situs || !record.city || !record.state || !record.zip) return null
  const address = `${record.situs}, ${record.city}, ${record.state} ${record.zip}`
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('address', address)
    url.searchParams.set('key', key)
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!response.ok) return null
    const body = await response.json() as { results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }> }
    const location = body.results?.[0]?.geometry?.location
    if (typeof location?.lat !== 'number' || typeof location.lng !== 'number') return null
    if (Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180) return null
    return { latitude: location.lat, longitude: location.lng }
  } catch {
    return null
  }
}

function countNotices(value: number | string | null | undefined): number {
  const parsed = numberOrNull(value ?? null)
  if (parsed == null || parsed < 0) return 0
  return Math.min(999, Math.floor(parsed))
}

function numberOrNull(value: number | string | null): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function assertId(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ForeclosureError('invalid_id', 400, 'Foreclosure prospect id is invalid.')
}
