import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import { phoneLookupVariants } from '@/lib/dialer-call-policy'
import {
  type IntakeMatchCandidate,
  type IntakeReviewRow,
  type IntakeTimelineEvent,
  type PreparedIntake,
  FORECLOSURE_INTAKE_BATCH_LIMIT,
  appendIntakeNotice,
  bestIntakeMatch,
  foreclosureIntakeOutreachBlockers,
  isProtectedSandboxFiling,
  matchIntakeSourceDefinition,
  normalizeNoticeKey,
  normalizeParcelId,
  normalizePartyName,
  normalizeStreetAddress,
  noticeTypeForIntake,
  openingTimeline,
  parseIntakeBatch,
  prepareIntakeRow,
} from '@/lib/prospecting/foreclosure-intake'
import {
  appendNoticeFileEvents,
  classifyOwnerEntity,
  normalizeCounty,
  parseNoticeTimeline,
} from '@/lib/prospecting/foreclosure'
import { ForeclosureError } from '@/lib/server/foreclosure-prospects'
import { supabase } from '@/lib/supabase-lazy'

const INTAKE = 'mortgage_foreclosure_intake'
const SOURCES = 'mortgage_foreclosure_intake_sources'
const CONTROLS = 'mortgage_foreclosure_ingest_controls'
const PROSPECTS = 'mortgage_foreclosure_prospects'
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface IntakeStored {
  id: string
  source_key: string
  source_name: string
  source_url: string | null
  pull_date: string | null
  review_status: 'pending' | 'approved' | 'rejected'
  county: string
  state: string | null
  notice_type: string | null
  case_number: string | null
  instrument_number: string | null
  filing_or_notice_date: string | null
  sale_date: string | null
  property_address: string | null
  owner_name: string | null
  trustee_or_firm: string | null
  stage: string | null
  parcel_id: string | null
  zip: string | null
  address_key: string | null
  owner_key: string | null
  trustee_key: string | null
  notice_key: string | null
  notice_lifecycle: string | null
  sale_status: string | null
  court_confirmed: boolean | null
  recorder_confirmed: boolean | null
  equity_band: string | null
  notice_timeline: unknown
  matched_prospect_id: string | null
  promoted_prospect_id: string | null
  raw_payload?: unknown
}

export interface IntakeBatchResult {
  accepted: number
  appended: number
  rejected: Array<{ row: number; code: string; reason: string }>
}

export async function ingestForeclosureBatch(body: unknown): Promise<IntakeBatchResult> {
  const parsed = parseIntakeBatch(body)
  if ('error' in parsed) throw new ForeclosureError('invalid_intake', 400, parsed.error)
  const rejected: IntakeBatchResult['rejected'] = []
  if (parsed.truncated) {
    rejected.push({
      row: FORECLOSURE_INTAKE_BATCH_LIMIT + 1,
      code: 'batch_limit',
      reason: `A batch stops at ${FORECLOSURE_INTAKE_BATCH_LIMIT} rows.`,
    })
  }
  let accepted = 0
  let appended = 0
  for (let index = 0; index < parsed.rows.length; index += 1) {
    const outcome = await ingestOne(parsed.rows[index], parsed.pullDate)
    if (!outcome.ok) {
      rejected.push({ row: index + 1, code: outcome.code, reason: outcome.reason })
      continue
    }
    if (outcome.appended) appended += 1
    else accepted += 1
  }
  return { accepted, appended, rejected }
}

export async function listPendingForeclosureIntake(): Promise<IntakeReviewRow[]> {
  const { data, error } = await supabase
    .from(INTAKE)
    .select('id, source_name, source_url, notice_timeline, sale_date, county, state, owner_name, trustee_or_firm, equity_band, review_status')
    .eq('review_status', 'pending')
    .order('sale_date', { ascending: true, nullsFirst: false })
    .limit(200)
  if (error) throw databaseError(error)
  return ((data ?? []) as IntakeStored[]).map(toReviewRow)
}

export async function reviewForeclosureIntake(
  actor: AuthenticatedActor,
  input: { action?: unknown; ids?: unknown },
): Promise<{ approved: string[]; rejected: string[]; errors: Array<{ id: string; reason: string }> }> {
  const action = input.action === 'approve' || input.action === 'reject' ? input.action : null
  const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === 'string') : []
  if (!action) throw new ForeclosureError('invalid_review', 400, 'Choose approve or reject.')
  if (ids.length === 0 || ids.length > 200) throw new ForeclosureError('invalid_review', 400, 'Choose at least one pending row.')
  const approved: string[] = []
  const rejected: string[] = []
  const errors: Array<{ id: string; reason: string }> = []
  for (const id of ids) {
    try {
      if (action === 'approve') {
        await approveOne(actor, id)
        approved.push(id)
      } else {
        await rejectOne(actor, id)
        rejected.push(id)
      }
    } catch (error) {
      errors.push({ id, reason: error instanceof ForeclosureError ? error.message : 'That row could not be reviewed.' })
    }
  }
  return { approved, rejected, errors }
}

/**
 * Holding-area gate for any dialer or export attempt.
 * Pending and rejected rows stop here. Do-not-call, opt-out, and the
 * Kansas license flag are evaluated before a row could leave.
 * This function does not write a prospect, a phone, or an export.
 */
export async function attemptForeclosureIntakeDialerOrExport(id: string): Promise<{ allowed: false; blockers: string[] }> {
  assertId(id)
  const row = await loadIntake(id)
  const phones: string[] = []
  const optedOut = await optedOutPhone(phones)
  const ksLicenseConfirmed = process.env.KS_FORECLOSURE_LICENSE_CONFIRMED === 'true' ? true : null
  const blockers = foreclosureIntakeOutreachBlockers({
    reviewStatus: row.review_status,
    state: row.state,
    county: row.county,
    dnc: false,
    optedOut,
    ksLicenseConfirmed,
  })
  if (blockers.length === 0) blockers.push('intake_holding_area')
  return { allowed: false, blockers }
}

async function ingestOne(input: Record<string, unknown>, pullDate: string | null): Promise<{ ok: true; appended: boolean } | { ok: false; code: string; reason: string }> {
  const definition = matchIntakeSourceDefinition(input.source ?? input.source_name)
  if (!definition) return { ok: false, code: 'unknown_source', reason: 'That source is not in the foreclosure intake registry.' }
  const sourceRow = await loadSource(definition.key)
  const county = normalizeCounty(input.county)
  const stage = typeof input.stage === 'string' ? input.stage : null
  const control = county ? await loadControl(county, noticeTypeForIntake(definition, stage)) : null
  const prepared = prepareIntakeRow(input, sourceRow, control, pullDate)
  if (!prepared.ok) return prepared
  const match = bestIntakeMatch(prepared.record, await loadCandidates(prepared.record))
  if (match?.candidate.kind === 'intake') {
    await appendToIntake(match.candidate.id, prepared.record)
    return { ok: true, appended: true }
  }
  await insertIntake(prepared.record, match?.candidate ?? null)
  return { ok: true, appended: false }
}

async function appendToIntake(id: string, record: PreparedIntake) {
  const current = await loadIntake(id)
  const appended = appendIntakeNotice({
    timeline: timelineOf(current.notice_timeline),
    saleDate: current.sale_date,
    sourceName: current.source_name,
    stage: current.stage,
    sourceUrl: current.source_url,
  }, {
    date: record.filingOrNoticeDate ?? record.pullDate,
    source: record.sourceName,
    stage: record.stage,
    saleDate: record.saleDate,
    url: record.sourceUrl,
  })
  if (appended.duplicate) return
  const reopen = appended.republished || current.review_status === 'pending'
  const { error } = await supabase.from(INTAKE).update({
    sale_date: appended.saleDate,
    notice_timeline: appended.timeline,
    stage: record.stage ?? current.stage,
    source_url: record.sourceUrl ?? current.source_url,
    notice_lifecycle: record.noticeLifecycle,
    sale_status: record.saleStatus,
    court_confirmed: record.courtConfirmed,
    raw_payload: record.raw,
    pull_date: record.pullDate ?? current.pull_date,
    review_status: reopen ? 'pending' : current.review_status,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw databaseError(error)
}

async function insertIntake(record: PreparedIntake, filing: IntakeMatchCandidate | null) {
  const prior = filing?.saleDate ? [{
    date: null,
    source: filing.sourceName,
    stage: filing.stage,
    sale_date: filing.saleDate,
    url: filing.sourceUrl,
  }] : []
  const timeline = prior.length === 0
    ? openingTimeline(record)
    : appendIntakeNotice({
      timeline: prior,
      saleDate: filing?.saleDate ?? null,
      sourceName: filing?.sourceName ?? null,
      stage: filing?.stage ?? null,
      sourceUrl: filing?.sourceUrl ?? null,
    }, {
      date: record.filingOrNoticeDate ?? record.pullDate,
      source: record.sourceName,
      stage: record.stage,
      saleDate: record.saleDate,
      url: record.sourceUrl,
    }).timeline
  const { error } = await supabase.from(INTAKE).insert(intakePayload(record, timeline, filing?.kind === 'filing' ? filing.id : null))
  if (error) throw databaseError(error)
}

async function approveOne(actor: AuthenticatedActor, id: string) {
  assertId(id)
  const row = await loadIntake(id)
  if (row.review_status !== 'pending') throw new ForeclosureError('not_pending', 409, 'Only a pending row can be approved.')
  if (isProtectedSandboxFiling({ ownerName: row.owner_name, propertyAddress: row.property_address })) {
    throw new ForeclosureError('sandbox_protected', 409, 'The sandbox filing stays unchanged.')
  }
  const promotedId = row.matched_prospect_id
    ? await updateMatchedFiling(actor, row)
    : await insertFiling(actor, row)
  const { error } = await supabase.from(INTAKE).update({
    review_status: 'approved',
    approved_by: actor.email,
    approved_at: new Date().toISOString(),
    promoted_prospect_id: promotedId,
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('review_status', 'pending')
  if (error) throw databaseError(error)
}

async function rejectOne(actor: AuthenticatedActor, id: string) {
  assertId(id)
  const { data, error } = await supabase.from(INTAKE).update({
    review_status: 'rejected',
    rejected_by: actor.email,
    rejected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('review_status', 'pending').select('id').maybeSingle<{ id: string }>()
  if (error) throw databaseError(error)
  if (!data) throw new ForeclosureError('not_pending', 409, 'Only a pending row can be rejected.')
}

async function updateMatchedFiling(actor: AuthenticatedActor, row: IntakeStored): Promise<string> {
  const { data, error } = await supabase.from(PROSPECTS).select('id, owner_name, situs, sale_date, attorney_name, notice_timeline, status').eq('id', row.matched_prospect_id).maybeSingle<{
    id: string
    owner_name: string
    situs: string
    sale_date: string | null
    attorney_name: string | null
    notice_timeline: unknown
    status: string
  }>()
  if (error) throw databaseError(error)
  if (!data) return insertFiling(actor, row)
  if (isProtectedSandboxFiling({ ownerName: data.owner_name, situs: data.situs })) {
    throw new ForeclosureError('sandbox_protected', 409, 'The sandbox filing stays unchanged.')
  }
  if (row.sale_date && row.sale_date !== data.sale_date) {
    const timeline = appendNoticeFileEvents(
      parseNoticeTimeline(data.notice_timeline),
      { saleDate: data.sale_date, attorneyName: data.attorney_name },
      { saleDate: row.sale_date, attorneyName: data.attorney_name },
    )
    const { error: updateError } = await supabase.from(PROSPECTS).update({
      sale_date: row.sale_date,
      notice_timeline: timeline,
      updated_by: actor.email,
      updated_at: new Date().toISOString(),
    }).eq('id', data.id)
    if (updateError) throw databaseError(updateError)
  }
  return data.id
}

async function insertFiling(actor: AuthenticatedActor, row: IntakeStored): Promise<string> {
  if (!row.owner_name || !row.property_address || !row.state) {
    throw new ForeclosureError('incomplete_intake', 409, 'Owner, address, and state have to be present before a row can go live.')
  }
  const externalRowId = `intake:${row.id}`
  const existing = await supabase.from(PROSPECTS).select('id').eq('external_row_id', externalRowId).maybeSingle<{ id: string }>()
  if (existing.error) throw databaseError(existing.error)
  if (existing.data) return existing.data.id
  const court = row.source_key === 'casenet' || row.source_key === 'ks_efiling'
  const opened = appendNoticeFileEvents(
    [],
    { saleDate: null, attorneyName: null },
    { saleDate: row.sale_date, attorneyName: null },
  )
  const inserted = await supabase.from(PROSPECTS).insert({
    external_row_id: externalRowId,
    county: row.county,
    state: row.state,
    status: 'new',
    notice_lifecycle: row.notice_lifecycle ?? 'unknown',
    source_name: row.source_name,
    source_url: row.source_url,
    pull_date: row.pull_date,
    notice_or_filing_date: row.filing_or_notice_date,
    sale_date: row.sale_date,
    case_number: row.case_number,
    instrument_number: row.instrument_number,
    owner_name: row.owner_name,
    owner_entity: classifyOwnerEntity(row.owner_name),
    plaintiff_lender: court ? row.trustee_or_firm : null,
    trustee_or_firm: court ? null : row.trustee_or_firm,
    situs: row.property_address,
    zip: row.zip,
    parcel_id: row.parcel_id,
    notice_type: row.notice_type,
    notice_type_source: row.source_name,
    sale_status: row.sale_status ?? 'unknown',
    notice_timeline: opened,
    court_confirmed: row.court_confirmed === true,
    recorder_confirmed: row.recorder_confirmed === true,
    equity_band: 'unknown',
    tax_or_dlt_flag: false,
    outreach_count: 0,
    notices_sent: 0,
    created_by: actor.email,
    updated_by: actor.email,
  }).select('id').single<{ id: string }>()
  if (inserted.error || !inserted.data) throw databaseError(inserted.error)
  return inserted.data.id
}

async function loadCandidates(record: PreparedIntake): Promise<IntakeMatchCandidate[]> {
  const intakeRows = await Promise.all([
    eqRows(INTAKE, 'parcel_id', record.parcelId),
    eqRows(INTAKE, 'notice_key', record.noticeKey),
    record.addressKey && record.zip ? eqRows(INTAKE, 'address_key', record.addressKey, { zip: record.zip }) : Promise.resolve([]),
    record.ownerKey && record.trusteeKey && record.saleDate
      ? eqRows(INTAKE, 'owner_key', record.ownerKey, { trustee_key: record.trusteeKey, sale_date: record.saleDate })
      : Promise.resolve([]),
  ])
  const filingRows = await Promise.all([
    eqRows(PROSPECTS, 'parcel_id', record.parcelId),
    eqRows(PROSPECTS, 'case_number', record.caseNumber),
    eqRows(PROSPECTS, 'instrument_number', record.instrumentNumber),
    record.zip ? eqRows(PROSPECTS, 'zip', record.zip) : Promise.resolve([]),
    record.saleDate ? eqRows(PROSPECTS, 'sale_date', record.saleDate) : Promise.resolve([]),
  ])
  const intake = uniqueById(intakeRows.flat()).map(intakeCandidate)
  const filings = uniqueById(filingRows.flat()).map(filingCandidate)
  return [...intake, ...filings]
}

function intakeCandidate(row: Record<string, unknown>): IntakeMatchCandidate {
  return {
    id: String(row.id),
    kind: 'intake',
    parcelId: normalizeParcelId(row.parcel_id),
    addressKey: typeof row.address_key === 'string' ? row.address_key : null,
    zip: typeof row.zip === 'string' ? row.zip : null,
    ownerKey: typeof row.owner_key === 'string' ? row.owner_key : null,
    trusteeKey: typeof row.trustee_key === 'string' ? row.trustee_key : null,
    saleDate: typeof row.sale_date === 'string' ? row.sale_date : null,
    noticeKey: typeof row.notice_key === 'string' ? row.notice_key : null,
    ownerName: typeof row.owner_name === 'string' ? row.owner_name : null,
    situs: typeof row.property_address === 'string' ? row.property_address : null,
    timeline: timelineOf(row.notice_timeline),
    sourceName: typeof row.source_name === 'string' ? row.source_name : null,
    stage: typeof row.stage === 'string' ? row.stage : null,
    sourceUrl: typeof row.source_url === 'string' ? row.source_url : null,
    reviewStatus: row.review_status === 'approved' || row.review_status === 'rejected' ? row.review_status : 'pending',
  }
}

function filingCandidate(row: Record<string, unknown>): IntakeMatchCandidate {
  const caseNumber = typeof row.case_number === 'string' ? row.case_number : null
  const instrument = typeof row.instrument_number === 'string' ? row.instrument_number : null
  const owner = typeof row.owner_name === 'string' ? row.owner_name : null
  const trustee = typeof row.trustee_or_firm === 'string' ? row.trustee_or_firm : null
  const situs = typeof row.situs === 'string' ? row.situs : null
  return {
    id: String(row.id),
    kind: 'filing',
    parcelId: normalizeParcelId(row.parcel_id),
    addressKey: normalizeStreetAddress(situs),
    zip: typeof row.zip === 'string' ? row.zip : null,
    ownerKey: normalizePartyName(owner),
    trusteeKey: normalizePartyName(trustee),
    saleDate: typeof row.sale_date === 'string' ? row.sale_date : null,
    noticeKey: normalizeNoticeKey(caseNumber ?? instrument),
    ownerName: owner,
    situs,
    timeline: [],
    sourceName: typeof row.source_name === 'string' ? row.source_name : null,
    stage: null,
    sourceUrl: typeof row.source_url === 'string' ? row.source_url : null,
  }
}

function intakePayload(record: PreparedIntake, timeline: IntakeTimelineEvent[], matchedProspectId: string | null) {
  return {
    source_key: record.sourceKey,
    source_name: record.sourceName,
    source_url: record.sourceUrl,
    pull_date: record.pullDate,
    raw_payload: record.raw,
    review_status: 'pending',
    county: record.county,
    state: record.state,
    notice_type: record.noticeType,
    case_number: record.caseNumber,
    instrument_number: record.instrumentNumber,
    filing_or_notice_date: record.filingOrNoticeDate,
    sale_date: record.saleDate,
    property_address: record.propertyAddress,
    owner_name: record.ownerName,
    trustee_or_firm: record.trusteeOrFirm,
    stage: record.stage,
    parcel_id: record.parcelId,
    zip: record.zip,
    address_key: record.addressKey,
    owner_key: record.ownerKey,
    trustee_key: record.trusteeKey,
    notice_key: record.noticeKey,
    notice_lifecycle: record.noticeLifecycle,
    sale_status: record.saleStatus,
    court_confirmed: record.courtConfirmed,
    recorder_confirmed: record.recorderConfirmed,
    equity_band: record.equityBand,
    notice_timeline: timeline,
    matched_prospect_id: matchedProspectId,
  }
}

async function loadSource(sourceKey: string): Promise<{ enabled: boolean } | null> {
  const { data, error } = await supabase.from(SOURCES).select('enabled').eq('source_key', sourceKey).maybeSingle<{ enabled: boolean }>()
  if (error) throw databaseError(error)
  return data
}

async function loadControl(county: string, noticeType: string): Promise<{ paused: boolean } | null> {
  const { data, error } = await supabase.from(CONTROLS).select('paused').eq('county', county).eq('notice_type', noticeType).maybeSingle<{ paused: boolean }>()
  if (error) throw databaseError(error)
  return data
}

async function loadIntake(id: string): Promise<IntakeStored> {
  const { data, error } = await supabase.from(INTAKE).select('*').eq('id', id).maybeSingle<IntakeStored>()
  if (error) throw databaseError(error)
  if (!data) throw new ForeclosureError('not_found', 404, 'That intake row was not found.')
  return data
}

async function eqRows(table: string, column: string, value: string | null, extra: Record<string, string> = {}): Promise<Record<string, unknown>[]> {
  if (!value) return []
  let query = supabase.from(table).select('*').eq(column, value)
  for (const [key, extraValue] of Object.entries(extra)) query = query.eq(key, extraValue)
  const { data, error } = await query.limit(25)
  if (error) throw databaseError(error)
  return (data ?? []) as Record<string, unknown>[]
}

async function optedOutPhone(phones: string[]): Promise<boolean> {
  const variants = phones.flatMap((phone) => phoneLookupVariants(phone))
  if (variants.length === 0) return false
  const { data, error } = await supabase.from('sms_opt_outs').select('phone').in('phone', variants).eq('is_opted_out', true).limit(1)
  if (error) throw databaseError(error)
  return (data ?? []).length > 0
}

function toReviewRow(row: IntakeStored): IntakeReviewRow {
  return {
    id: row.id,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    timeline: timelineOf(row.notice_timeline),
    saleDate: row.sale_date,
    county: row.county,
    state: row.state,
    ownerName: row.owner_name,
    trusteeOrFirm: row.trustee_or_firm,
    equityBand: row.equity_band,
    reviewStatus: row.review_status,
  }
}

function timelineOf(raw: unknown): IntakeTimelineEvent[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const event = item as Record<string, unknown>
    return [{
      date: typeof event.date === 'string' ? event.date : null,
      source: typeof event.source === 'string' ? event.source : null,
      stage: typeof event.stage === 'string' ? event.stage : null,
      sale_date: typeof event.sale_date === 'string' ? event.sale_date : null,
      url: typeof event.url === 'string' ? event.url : null,
    }]
  })
}

function uniqueById(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const id = String(row.id ?? '')
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function assertId(id: string) {
  if (!ID_PATTERN.test(id)) throw new ForeclosureError('invalid_review', 400, 'That intake id is not valid.')
}

function databaseError(error: { message?: string; code?: string } | null | undefined): ForeclosureError {
  const detail = `${error?.message || ''} ${error?.code || ''}`.toLowerCase()
  if (detail.includes('42p01') || detail.includes('does not exist') || detail.includes('pgrst205')) {
    return new ForeclosureError('foreclosure_unavailable', 503, 'Foreclosure intake storage is not available in this environment yet.')
  }
  console.error('[foreclosure] intake storage error', { code: error?.code || 'unknown' })
  return new ForeclosureError('foreclosure_unavailable', 503, 'Foreclosure intake could not be saved.')
}
