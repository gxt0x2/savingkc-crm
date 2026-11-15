import { supabaseAdmin } from '@/lib/supabase/admin'
import { isTaxSourcedList } from './decision'
import type { StoredTaxCheck, TaxGateCandidate, TaxGateContact } from './gate'
import { createLiveBalanceLookup } from './live-lookup'
import { confirmMojoRemoval, removalWorkItems, type MojoRemovalWorkItem } from './mojo-removal'
import { runTaxStatusPlans, summarizeTaxStatusRun, type TaxStatusRun } from './run'
import { taxStatusWindow } from './schedule'

type QueryResult<T> = { data: T[] | null; error: { message?: string } | null }

const ACTOR = 'tax-status-gate'

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asTier(value: unknown): '2yr' | '3yr_plus' | null {
  return value === '2yr' || value === '3yr_plus' ? value : null
}

function phonesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function contactsFor(name: string | null, phones: string[], listName: string): TaxGateContact[] {
  const contactName = name?.trim() || 'Unknown owner'
  const list = listName.trim()
  if (!list) return []
  return phones.map((phone) => ({ name: contactName, phone: phone.trim(), mojoListName: list }))
}

export class TaxStatusStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaxStatusStoreError'
  }
}

function unwrap<T>(result: QueryResult<T>, label: string): T[] {
  if (result.error) throw new TaxStatusStoreError(`${label} could not be read`)
  return result.data ?? []
}

interface SourceRow {
  id: string
  list_type: string
  county: string | null
  parcel_id: string | null
  status: string
  property_id: string | null
  prospect_id: string | null
  owner_names: string | null
  phones: string[] | null
  created_at: string
  updated_at: string
  source_lists?: { source_file_name?: string | null } | { source_file_name?: string | null }[] | null
}

interface ProspectRow {
  id: string
  parcel_id: string | null
  county: string | null
  prospect_track: 'tax' | 'mortgage_foreclosure' | null
  delinquent_years_category: string | null
  owner_1: string | null
  created_at: string
  updated_at: string
}

interface ForeclosureRow {
  id: string
  county: string | null
  parcel_id: string | null
  owner_name: string | null
  status: string | null
  created_at: string
  updated_at: string
}

interface MemberRow {
  prospect_id: string | null
  phone_snapshot: string | null
  prospecting_campaigns?: { name?: string | null; kind?: string | null } | { name?: string | null; kind?: string | null }[] | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function listName(row: SourceRow): string {
  const file = one(row.source_lists)?.source_file_name
  if (file && file.trim()) return file.trim()
  const county = (row.county ?? 'county').trim()
  return `${county} ${row.list_type}`.replaceAll('_', ' ')
}

export async function loadTaxGateCandidates(now: Date): Promise<{
  candidates: TaxGateCandidate[]
  storedByKey: Map<string, StoredTaxCheck>
}> {
  const db = supabaseAdmin()
  const since = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString()
  const olderThan = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [sourceRecent, sourcePipeline, prospectsRecent, prospectsOld, foreclosuresRecent, foreclosuresOld, members, checks] = await Promise.all([
    db.from('source_list_rows').select('id, list_type, county, parcel_id, status, property_id, prospect_id, owner_names, phones, created_at, updated_at, source_lists(source_file_name)').gte('updated_at', since).limit(400),
    db.from('source_list_rows').select('id, list_type, county, parcel_id, status, property_id, prospect_id, owner_names, phones, created_at, updated_at, source_lists(source_file_name)').in('status', ['new', 'needs_check', 'ready', 'loaded_to_dialer']).lte('created_at', olderThan).limit(400),
    db.from('prospects').select('id, parcel_id, county, prospect_track, delinquent_years_category, owner_1, created_at, updated_at').gte('updated_at', since).limit(400),
    db.from('prospects').select('id, parcel_id, county, prospect_track, delinquent_years_category, owner_1, created_at, updated_at').lte('created_at', olderThan).limit(400),
    db.from('mortgage_foreclosure_prospects').select('id, county, parcel_id, owner_name, status, created_at, updated_at').gte('updated_at', since).limit(200),
    db.from('mortgage_foreclosure_prospects').select('id, county, parcel_id, owner_name, status, created_at, updated_at').lte('created_at', olderThan).limit(200),
    db.from('prospecting_campaign_members').select('prospect_id, phone_snapshot, prospecting_campaigns!inner(name, kind)').eq('status', 'active').eq('prospecting_campaigns.kind', 'dialer').limit(500),
    db.from('tax_status_checks').select('parcel_id, county, prospect_id, source_list_row_id, result, checked_at, source, balance, years_owed').order('checked_at', { ascending: false }).limit(1000),
  ])

  const sourceRows = [...unwrap(sourceRecent as QueryResult<SourceRow>, 'Source lists'), ...unwrap(sourcePipeline as QueryResult<SourceRow>, 'Source lists')]
  const prospectRows = [...unwrap(prospectsRecent as QueryResult<ProspectRow>, 'Prospects'), ...unwrap(prospectsOld as QueryResult<ProspectRow>, 'Prospects')]
  const foreclosureRows = [
    ...unwrap(foreclosuresRecent as QueryResult<ForeclosureRow>, 'Foreclosure prospects'),
    ...unwrap(foreclosuresOld as QueryResult<ForeclosureRow>, 'Foreclosure prospects'),
  ]
  const memberRows = unwrap(members as QueryResult<MemberRow>, 'Dialer campaign members')
  const checkRows = unwrap(checks as QueryResult<{
    parcel_id: string | null
    county: string | null
    prospect_id: string | null
    source_list_row_id: string | null
    result: StoredTaxCheck['result']
    checked_at: string
    source: string
    balance: number | null
    years_owed: number | null
  }>, 'Tax status checks')

  const dialerByProspect = new Map<string, { phone: string; list: string }>()
  for (const member of memberRows) {
    if (!member.prospect_id || dialerByProspect.has(member.prospect_id)) continue
    const campaign = one(member.prospecting_campaigns)
    dialerByProspect.set(member.prospect_id, {
      phone: member.phone_snapshot ?? '',
      list: campaign?.name?.trim() || 'Dialer campaign',
    })
  }

  const byKey = new Map<string, TaxGateCandidate>()
  for (const row of sourceRows) {
    const key = `source:${row.id}`
    if (byKey.has(key)) continue
    const dialer = row.prospect_id ? dialerByProspect.get(row.prospect_id) : undefined
    const phones = phonesOf(row.phones)
    if (dialer?.phone && !phones.includes(dialer.phone)) phones.push(dialer.phone)
    byKey.set(key, {
      key,
      parcelId: asText(row.parcel_id),
      county: asText(row.county),
      listType: row.list_type,
      prospectTrack: null,
      tier: null,
      historicalTag: null,
      createdAt: row.created_at,
      scoredAt: row.updated_at,
      onDialerList: row.status === 'loaded_to_dialer' || Boolean(dialer),
      rowStatus: row.status,
      propertyId: row.property_id,
      prospectId: row.prospect_id,
      sourceListRowId: row.id,
      foreclosureId: null,
      contacts: contactsFor(row.owner_names, phones, dialer?.list || listName(row)),
    })
  }

  for (const row of prospectRows) {
    const key = `prospect:${row.id}`
    if ([...byKey.values()].some((candidate) => candidate.prospectId === row.id)) continue
    const dialer = dialerByProspect.get(row.id)
    const listType = row.prospect_track === 'mortgage_foreclosure' ? 'foreclosure' : 'tax_delinquent'
    byKey.set(key, {
      key,
      parcelId: asText(row.parcel_id),
      county: asText(row.county),
      listType,
      prospectTrack: row.prospect_track,
      tier: asTier(row.delinquent_years_category),
      historicalTag: asTier(row.delinquent_years_category),
      createdAt: row.created_at,
      scoredAt: row.updated_at,
      onDialerList: Boolean(dialer),
      rowStatus: null,
      propertyId: null,
      prospectId: row.id,
      sourceListRowId: null,
      foreclosureId: null,
      contacts: contactsFor(row.owner_1, dialer?.phone ? [dialer.phone] : [], dialer?.list || `${row.county ?? 'county'} tax`),
    })
  }

  for (const row of foreclosureRows) {
    const key = `foreclosure:${row.id}`
    byKey.set(key, {
      key,
      parcelId: asText(row.parcel_id),
      county: asText(row.county),
      listType: 'foreclosure',
      prospectTrack: 'mortgage_foreclosure',
      tier: null,
      historicalTag: null,
      createdAt: row.created_at,
      scoredAt: row.updated_at,
      onDialerList: false,
      rowStatus: row.status,
      propertyId: null,
      prospectId: null,
      sourceListRowId: null,
      foreclosureId: row.id,
      contacts: [],
    })
  }

  const storedByKey = new Map<string, StoredTaxCheck>()
  for (const row of checkRows) {
    const stored: StoredTaxCheck = {
      result: row.result,
      checkedAt: row.checked_at,
      source: row.source,
      balance: row.balance === null ? null : Number(row.balance),
      yearsOwed: row.years_owed,
    }
    for (const candidate of byKey.values()) {
      if (storedByKey.has(candidate.key)) continue
      const sameProspect = candidate.prospectId && candidate.prospectId === row.prospect_id
      const sameRow = candidate.sourceListRowId && candidate.sourceListRowId === row.source_list_row_id
      const sameParcel = candidate.parcelId && candidate.parcelId === row.parcel_id && (candidate.county ?? '').toLowerCase() === (row.county ?? '').toLowerCase()
      if (sameProspect || sameRow || sameParcel) storedByKey.set(candidate.key, stored)
    }
  }

  return { candidates: [...byKey.values()], storedByKey }
}

async function insertCheck(plan: TaxStatusRun['plans'][number], checkedAt: string) {
  if (!plan.inServiceArea || plan.result === 'skipped_out_of_area') return
  const db = supabaseAdmin()
  const { error } = await db.from('tax_status_checks').insert({
    parcel_id: plan.candidate.parcelId,
    county: plan.county,
    list_type: plan.candidate.listType,
    property_id: plan.candidate.propertyId,
    prospect_id: plan.candidate.prospectId,
    source_list_row_id: plan.candidate.sourceListRowId,
    checked_at: checkedAt,
    source: plan.source,
    balance: plan.balance,
    years_owed: plan.yearsOwed,
    result: plan.result,
    tier_before: plan.tierBefore,
    tier_after: plan.tierAfter,
    rank_boost: plan.rankBoost,
  })
  if (error) throw new TaxStatusStoreError('Tax status check could not be saved')
}

async function stampRecords(plan: TaxStatusRun['plans'][number], checkedAt: string, callSources: boolean) {
  const db = supabaseAdmin()
  const taxList = isTaxSourcedList(plan.candidate.listType, plan.candidate.prospectTrack)
  if (callSources && plan.candidate.propertyId && plan.inServiceArea && plan.result !== 'skipped_out_of_area') {
    const { error } = await db.from('crm_properties').update({
      tax_owed: plan.balance,
      tax_status: plan.result,
      tax_check_at: checkedAt,
      tax_check_source: plan.source,
      tax_check_balance: plan.balance,
      tax_check_years_owed: plan.yearsOwed,
      tax_check_result: plan.result,
    }).eq('id', plan.candidate.propertyId)
    if (error) throw new TaxStatusStoreError('Property tax status could not be saved')
  }
  if (plan.candidate.prospectId && taxList && plan.candidate.prospectTrack !== 'mortgage_foreclosure' && plan.result !== 'not_verified' && plan.result !== 'skipped_out_of_area') {
    const { error } = await db.from('prospects').update({
      delinquent_years_category: plan.result === 'delinquent' ? plan.tierAfter : null,
      tax_check_at: checkedAt,
      tax_check_source: plan.source,
      tax_check_balance: plan.balance,
      tax_check_years_owed: plan.yearsOwed,
      tax_check_result: plan.result,
    }).eq('id', plan.candidate.prospectId).eq('prospect_track', 'tax')
    if (error) throw new TaxStatusStoreError('Prospect tax tier could not be saved')
  }
  if (plan.candidate.foreclosureId && plan.inServiceArea && plan.result !== 'skipped_out_of_area') {
    const { error } = await db.from('mortgage_foreclosure_prospects').update({
      tax_rank_boost: plan.rankBoost,
    }).eq('id', plan.candidate.foreclosureId)
    if (error) throw new TaxStatusStoreError('Foreclosure tax rank could not be saved')
  }
  if (plan.candidate.sourceListRowId && !taxList && plan.inServiceArea) {
    const { error } = await db.from('source_list_rows').update({
      tax_rank_boost: plan.rankBoost,
    }).eq('id', plan.candidate.sourceListRowId)
    if (error) throw new TaxStatusStoreError('List rank could not be saved')
  }
  if (plan.nextStatus && plan.candidate.sourceListRowId) {
    const { error } = await db.rpc('set_source_list_row_status_v1', {
      p_row_id: plan.candidate.sourceListRowId,
      p_status: plan.nextStatus,
      p_status_reason: plan.statusReason,
      p_actor: ACTOR,
    })
    if (error) throw new TaxStatusStoreError('Source list status could not be saved')
  }
}

async function queueRemovals(items: MojoRemovalWorkItem[]) {
  if (items.length === 0) return
  const db = supabaseAdmin()
  const phones = items.map((item) => item.phone)
  const { data, error } = await db.from('tax_status_mojo_removals').select('phone, mojo_list_name, status').in('phone', phones).eq('status', 'pending_browser')
  if (error) throw new TaxStatusStoreError('Mojo removal worklist could not be read')
  const pending = new Set((data ?? []).map((row: { phone: string; mojo_list_name: string }) => `${row.phone}|${row.mojo_list_name.toLowerCase()}`))
  const fresh = items.filter((item) => !pending.has(`${item.phone}|${item.mojoListName.toLowerCase()}`))
  if (fresh.length === 0) return
  const { error: insertError } = await db.from('tax_status_mojo_removals').insert(fresh.map((item) => ({
    contact_name: item.contactName,
    phone: item.phone,
    mojo_list_name: item.mojoListName,
    parcel_id: item.parcelId,
    county: item.county,
    prospect_id: item.prospectId,
    property_id: item.propertyId,
    source_list_row_id: item.sourceListRowId,
    status: 'pending_browser',
  })))
  if (insertError) throw new TaxStatusStoreError('Mojo removal worklist could not be saved')
}

export async function executeTaxStatusBatch(now = new Date()) {
  const window = taxStatusWindow(now)
  if (window.phase === 'idle') {
    return summarizeTaxStatusRun({ window, considered: 0, plans: [], truncated: false })
  }
  const loaded = await loadTaxGateCandidates(now)
  const run = await runTaxStatusPlans({
    now,
    candidates: loaded.candidates,
    storedByKey: loaded.storedByKey,
    lookup: createLiveBalanceLookup(fetch, now),
  })
  if (run.window.callSources) {
    for (const plan of run.plans) {
      if (!plan.inServiceArea || plan.result === 'skipped_out_of_area') continue
      await insertCheck(plan, now.toISOString())
      await stampRecords(plan, now.toISOString(), true)
    }
  } else {
    for (const plan of run.plans) await stampRecords(plan, now.toISOString(), false)
  }
  await queueRemovals(removalWorkItems(run.plans))
  return summarizeTaxStatusRun(run)
}

export async function readPendingMojoRemovals(): Promise<MojoRemovalWorkItem[]> {
  const db = supabaseAdmin()
  const { data, error } = await db.from('tax_status_mojo_removals').select('id, contact_name, phone, mojo_list_name, parcel_id, county, prospect_id, property_id, source_list_row_id, status').eq('status', 'pending_browser').order('requested_at', { ascending: true }).limit(5000)
  if (error) throw new TaxStatusStoreError('Mojo removal worklist could not be read')
  return (data ?? []).map((row: {
    id: string
    contact_name: string
    phone: string
    mojo_list_name: string
    parcel_id: string | null
    county: string | null
    prospect_id: string | null
    property_id: string | null
    source_list_row_id: string | null
    status: 'pending_browser'
  }) => ({
    id: row.id,
    contactName: row.contact_name,
    phone: row.phone,
    mojoListName: row.mojo_list_name,
    parcelId: row.parcel_id,
    county: row.county,
    prospectId: row.prospect_id,
    propertyId: row.property_id,
    sourceListRowId: row.source_list_row_id,
    status: row.status,
  }))
}

export async function confirmPendingMojoRemovals(ids: string[], actor: string, now = new Date()) {
  const confirmation = confirmMojoRemoval(actor, now)
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  if (unique.length === 0) throw new TaxStatusStoreError('Choose at least one removal to confirm')
  const db = supabaseAdmin()
  const { data, error } = await db.from('tax_status_mojo_removals').update({
    status: confirmation.status,
    confirmed_at: confirmation.confirmedAt,
    confirmed_by: confirmation.confirmedBy,
  }).in('id', unique).eq('status', 'pending_browser').select('id')
  if (error) throw new TaxStatusStoreError('Mojo removal confirmation could not be saved')
  return { confirmed: (data ?? []).length, confirmedAt: confirmation.confirmedAt, confirmedBy: confirmation.confirmedBy }
}
