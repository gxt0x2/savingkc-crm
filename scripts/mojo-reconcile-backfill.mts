#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { normalizePhoneToE164 } from '../src/lib/phone-normalize'
import { MOJO_FIELD_OWNERSHIP } from '../src/lib/server/mojo-field-ownership'
import {
  reconcileMojoCalls,
  mojoCentralDate,
  type MojoExistingEvent,
  type MojoReconciliationLead,
  type MojoReconciliationProspectPhone,
} from '../src/lib/server/mojo-reconciliation'
import type { MojoCallRecord } from '../src/lib/server/mojo-call-import'
import { loadMojoEnv, mojoSessionFile } from './mojo-session-health.mjs'

loadMojoEnv()

const MOJO_BASE_URL = 'https://app71.mojosells.com'
const DEFAULT_START = '2026-06-10'
const DEFAULT_MAX_RECORDS = 2_000
const DEFAULT_MAX_CONTACTS = 1_000
const CHUNK_DAYS = 7
const PAGE_SIZE = 1_000
const MAX_DB_ROWS = 20_000

function cliValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function boundedInteger(flag: string, fallback: number, maximum: number): number {
  const value = Number(cliValue(flag, String(fallback)))
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${flag} must be between 1 and ${maximum}`)
  return value
}

function isoDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${field} must use YYYY-MM-DD`)
  }
  return value
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function readSessionId(): string {
  const file = mojoSessionFile()
  if (!fs.existsSync(file)) throw new Error('Mojo session is missing; reauthenticate first')
  const session = JSON.parse(fs.readFileSync(file, 'utf8')) as { expired?: boolean; sessionId?: string }
  if (session.expired || !session.sessionId) throw new Error('Mojo session is expired; reauthenticate first')
  return session.sessionId
}

function mojoHeaders(sessionId: string): Record<string, string> {
  return {
    accept: 'application/json, text/plain, */*',
    cookie: `sessionid=${sessionId}`,
    referer: `${MOJO_BASE_URL}/`,
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/151 Safari/537.36',
  }
}

async function mojoJson(sessionId: string, url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: mojoHeaders(sessionId),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  const contentType = response.headers.get('content-type') || ''
  if (response.status === 401 || response.status === 403 || !contentType.includes('json')) {
    throw new Error(`Mojo session is not usable (${response.status})`)
  }
  if (!response.ok) throw new Error(`Mojo request failed (${response.status})`)
  return await response.json() as Record<string, unknown>
}

type Recording = Record<string, unknown> & {
  record_id?: string | number
  contact?: { id?: string | number; name?: string }
  agent_name?: string
  duration?: string
  audio?: string
  result?: string
  date?: string
}

export async function fetchRecordings(sessionId: string, start: string, end: string, maxRecords: number): Promise<Recording[]> {
  const byId = new Map<string, Recording>()
  for (let cursor = start; cursor <= end;) {
    const chunkEnd = addDays(cursor, CHUNK_DAYS - 1) > end ? end : addDays(cursor, CHUNK_DAYS - 1)
    const url = new URL('/v2/rest/reports/call-recording-report-data/', MOJO_BASE_URL)
    url.searchParams.set('agents', '[-1]')
    url.searchParams.set('date_range', 'custom')
    url.searchParams.set('from', cursor)
    url.searchParams.set('to', chunkEnd)
    const body = await mojoJson(sessionId, url.toString())
    const rows = Array.isArray(body.recordings) ? body.recordings as Recording[] : []
    for (const row of rows) {
      const id = String(row.record_id || '').trim()
      const callDay = mojoCentralDate(String(row.date || ''))
      if (!callDay) throw new Error(`Mojo recording ${id || 'without an ID'} has an invalid call date`)
      if (callDay < start || callDay > end) continue
      if (id) byId.set(id, row)
      if (byId.size > maxRecords) throw new Error(`Mojo history exceeds the ${maxRecords}-record safety cap`)
    }
    cursor = addDays(chunkEnd, 1)
  }
  return [...byId.values()]
}

function durationSeconds(value: unknown): number {
  const parts = String(value || '').split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return Math.max(0, parts[0] || 0)
}

type ContactDetails = {
  phone: string
  email: string
  notes: string
  address: string
  city: string
  state: string
  zip: string
  followUpDate: string
}

async function fetchContact(sessionId: string, contactId: string): Promise<ContactDetails> {
  const body = await mojoJson(sessionId, `${MOJO_BASE_URL}/v2/rest/contacts/data/${encodeURIComponent(contactId)}/`)
  const media = Array.isArray(body.mediainfo_set) ? body.mediainfo_set as Array<Record<string, unknown>> : []
  const primaryPhone = media.find((item) => item.type === 3 && item.value) || media.find((item) => item.type === 2 && item.value)
  const email = media.find((item) => item.type === 4 && item.value)
  const notes = (Array.isArray(body.contactnote_set) ? body.contactnote_set as Array<Record<string, unknown>> : [])
    .map((item) => typeof item.contents === 'string' ? item.contents.trim() : '')
    .filter(Boolean)
    .join('\n')
  const futureEvents = (Array.isArray(body.event_set) ? body.event_set as Array<Record<string, unknown>> : [])
    .map((item) => String(item.datetime || item.date || ''))
    .filter((value) => Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now())
    .sort((a, b) => Date.parse(a) - Date.parse(b))
  return {
    phone: String(primaryPhone?.value || ''), email: String(email?.value || ''), notes,
    address: String(body.address || body.full_address || ''), city: String(body.city || ''),
    state: String(body.state || ''), zip: String(body.zip_code || body.zip || ''),
    followUpDate: futureEvents[0] || '',
  }
}

export async function fetchContacts(sessionId: string, recordings: Recording[], maxContacts: number): Promise<Map<string, ContactDetails>> {
  const ids = [...new Set(recordings.map((row) => String(row.contact?.id || '')).filter(Boolean))]
  if (ids.length > maxContacts) throw new Error(`Mojo history contains ${ids.length} contacts, above the ${maxContacts}-contact safety cap`)
  const result = new Map<string, ContactDetails>()
  for (let offset = 0; offset < ids.length; offset += 4) {
    const batch = ids.slice(offset, offset + 4)
    const details = await Promise.all(batch.map(async (id) => [id, await fetchContact(sessionId, id)] as const))
    for (const [id, value] of details) result.set(id, value)
  }
  return result
}

export function buildCalls(recordings: Recording[], contacts: Map<string, ContactDetails>): MojoCallRecord[] {
  return recordings.map((row) => {
    const details = contacts.get(String(row.contact?.id || ''))
    const callDate = new Date(String(row.date || ''))
    if (!String(row.record_id || '').trim() || !Number.isFinite(callDate.getTime())) throw new Error('Mojo returned an invalid recording identity or date')
    return {
      record_id: String(row.record_id), contact_name: String(row.contact?.name || 'Unknown'),
      phone_number: details?.phone || '', property_address: details?.address || '', city: details?.city || '',
      state: details?.state || '', zip: details?.zip || '', email: details?.email || '',
      call_date: callDate.toISOString(), call_duration: durationSeconds(row.duration),
      disposition: String(row.result || 'Unknown'), agent_name: String(row.agent_name || 'Unknown'),
      notes: details?.notes || '', recording_url: String(row.audio || ''), follow_up_date: details?.followUpDate || '',
      list_name: '', campaign_name: '',
    }
  })
}

export async function collectMojoBackfillCalls(input: {
  start: string
  end: string
  maxRecords: number
  maxContacts: number
}): Promise<MojoCallRecord[]> {
  const sessionId = readSessionId()
  const recordings = await fetchRecordings(sessionId, input.start, input.end, input.maxRecords)
  const contacts = await fetchContacts(sessionId, recordings, input.maxContacts)
  return buildCalls(recordings, contacts)
}

export function mojoDatasetDigest(calls: MojoCallRecord[]): string {
  const stable = [...calls].sort((left, right) => left.record_id.localeCompare(right.record_id))
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

async function pagedRows<T>(queryFactory: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; from < MAX_DB_ROWS; from += PAGE_SIZE) {
    const { data, error } = await queryFactory(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
  throw new Error(`CRM reconciliation exceeds the ${MAX_DB_ROWS}-row safety cap`)
}

async function rowsByIds<T extends { id: string }>(
  db: ReturnType<typeof createClient>,
  table: string,
  selection: string,
  ids: string[],
): Promise<T[]> {
  const rows = new Map<string, T>()
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await db.from(table).select(selection).in('id', ids.slice(offset, offset + 100)).limit(5_000)
    if (error) throw new Error(`${table} reconciliation failed: ${error.message}`)
    for (const row of (data ?? []) as unknown as T[]) rows.set(row.id, row)
  }
  return [...rows.values()]
}

async function normalizedCandidates(
  db: ReturnType<typeof createClient>,
  calls: MojoCallRecord[],
): Promise<{ leads: MojoReconciliationLead[]; prospectPhones: MojoReconciliationProspectPhone[] }> {
  const phones = [...new Set(calls.map((call) => normalizePhoneToE164(call.phone_number)).filter((phone): phone is string => Boolean(phone)))]
  const candidates = new Map<string, Set<string>>()
  for (let offset = 0; offset < phones.length; offset += 250) {
    const { data, error } = await db.rpc('resolve_mojo_reconciliation_candidates_v1', {
      p_phones: phones.slice(offset, offset + 250),
    })
    if (error) throw new Error(`Normalized Mojo identity reconciliation failed: ${error.message}`)
    for (const row of (data ?? []) as Array<{ normalized_phone?: unknown; lead_id?: unknown }>) {
      if (typeof row.normalized_phone !== 'string' || typeof row.lead_id !== 'string') continue
      const ids = candidates.get(row.normalized_phone) ?? new Set<string>()
      ids.add(row.lead_id)
      candidates.set(row.normalized_phone, ids)
    }
  }
  const leadIds = [...new Set([...candidates.values()].flatMap((ids) => [...ids]))]
  const leads = await rowsByIds<MojoReconciliationLead>(
    db,
    'leads',
    'id,full_name,phone,email,property_address,city,state,zip,source,mojo_record_id,call_result,call_duration_seconds,station,assigned_agent',
    leadIds,
  )
  const prospectPhones = [...candidates.entries()].flatMap(([phone, ids]) => [...ids].map((leadId) => ({ phone, leadId })))
  return { leads, prospectPhones }
}

async function main() {
  if (process.argv.includes('--apply')) throw new Error('This command is dry-run only; production writes are intentionally disabled')
  const today = new Date().toISOString().slice(0, 10)
  const start = isoDate(cliValue('--start', DEFAULT_START), '--start')
  const end = isoDate(cliValue('--end', today), '--end')
  if (start > end || end > today) throw new Error('Date range must end today or earlier and start before end')
  const maxRecords = boundedInteger('--max-records', DEFAULT_MAX_RECORDS, 5_000)
  const maxContacts = boundedInteger('--max-contacts', DEFAULT_MAX_CONTACTS, 2_000)
  const calls = await collectMojoBackfillCalls({ start, end, maxRecords, maxContacts })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase admin configuration is unavailable')
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { leads, prospectPhones } = await normalizedCandidates(db, calls)
  const existingEvents = await pagedRows<Record<string, unknown>>((from, to) => db.from('crm_mojo_call_events')
    .select('record_id,lead_id,call_at').gte('call_at', `${start}T00:00:00Z`).range(from, to))
  const normalizedEvents: MojoExistingEvent[] = existingEvents.map((row) => ({
    recordId: String(row.record_id || ''), leadId: typeof row.lead_id === 'string' ? row.lead_id : null, callAt: String(row.call_at || ''),
  }))
  const reconciliation = reconcileMojoCalls({ calls, leads, prospectPhones, existingEvents: normalizedEvents })
  const datasetDigest = mojoDatasetDigest(calls)
  const report = {
    dryRun: true,
    generatedAt: new Date().toISOString(),
    range: { start, end },
    bounds: { maxRecords, maxContacts, chunkDays: CHUNK_DAYS, maxDatabaseRows: MAX_DB_ROWS },
    datasetDigest,
    ownership: MOJO_FIELD_OWNERSHIP,
    ...reconciliation,
  }
  const defaultReport = path.join(homedir(), '.openclaw/workspace/memory/logs', `mojo-reconciliation-${start}-to-${end}.json`)
  const reportPath = path.resolve(cliValue('--report', defaultReport))
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ ok: true, dryRun: true, reportPath, range: report.range, datasetDigest, summary: report.summary }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[mojo-reconcile] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
