import 'server-only'

import { readFile, stat, unlink } from 'node:fs/promises'
import { downloadRecording } from '@/lib/mojo-recording-downloader'
import {
  MOJO_RECORDING_BUCKET,
  RECORDINGS_BUCKET,
  mojoCallStoragePath,
  mojoEventStoragePath,
  mojoRecordingSourceUrl,
  mojoRecordingUrlFromReportRow,
  recordingSidFromCallMetadata,
  twilioCallSid,
  twilioCallStoragePath,
  twilioRecordingSid,
  twilioStoragePath,
} from '@/lib/marketing/recording-playback'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { centralDateString } from '../../../scripts/mojo-call-evidence.mjs'

export const RECORDING_ARCHIVE_PAGE_LIMIT = 5
export const RECORDING_ARCHIVE_RATE_LIMIT_MS = 1000
export const RECORDING_ARCHIVE_READ_PAGE = 1000
const MAX_RECORDING_BYTES = 104857600
const MIN_RECORDING_BYTES = 1000
const MOJO_REPORT_PATH = '/v2/rest/reports/call-recording-report-data/'
const MOJO_BASE = 'https://app71.mojosells.com'

export type RecordingArchiveKind = 'mojo_event' | 'mojo_call' | 'twilio_attempt' | 'twilio_call'

export type RecordingArchiveTarget = {
  kind: RecordingArchiveKind
  id: string
  recordedAt: string
  leadId: string | null
  recordingUrl: string | null
  recordingSid: string | null
  callSid?: string | null
  storagePath: string | null
  isRecorded?: boolean
  providerCallId?: string | null
}

export type RecordingArchiveCounts = {
  mojoEvents: number
  mojoCalls: number
  twilioAttempts: number
  twilioCalls: number
  total: number
}

export type RecordingBackfillReport = {
  dryRun: boolean
  wouldArchive: RecordingArchiveCounts
  alreadyStored: RecordingArchiveCounts
  mojoCallsAwaitingUrl: number
  archived: number
  alreadyStoredThisRun: number
  skipped: number
  failed: number
  nextCursor: string | null
}

type ArchiveDeps = {
  downloadMojo: (url: string, id: string) => Promise<Uint8Array>
  downloadTwilio: (sid: string) => Promise<Uint8Array>
  resolveCallRecording?: (callSid: string) => Promise<string>
  upload: (bucket: string, path: string, bytes: Uint8Array) => Promise<void>
  markStored: (target: RecordingArchiveTarget, storagePath: string, copiedAt: string) => Promise<void>
  sleep: (ms: number) => Promise<void>
  now: () => Date
}

const emptyCounts = (): RecordingArchiveCounts => ({
  mojoEvents: 0, mojoCalls: 0, twilioAttempts: 0, twilioCalls: 0, total: 0,
})

function addCount(counts: RecordingArchiveCounts, kind: RecordingArchiveKind) {
  if (kind === 'mojo_event') counts.mojoEvents += 1
  else if (kind === 'mojo_call') counts.mojoCalls += 1
  else if (kind === 'twilio_call') counts.twilioCalls += 1
  else counts.twilioAttempts += 1
  counts.total += 1
}

export function recordingArchiveKey(row: RecordingArchiveTarget): string {
  return `${row.recordedAt}\t${row.kind}\t${row.id}`
}

export function recordingSourceReady(row: RecordingArchiveTarget): boolean {
  if (row.kind === 'twilio_attempt') return Boolean(twilioRecordingSid(row.recordingSid))
  if (row.kind === 'twilio_call') return Boolean(twilioRecordingSid(row.recordingSid) || twilioCallSid(row.callSid))
  return Boolean(mojoRecordingSourceUrl(row.recordingUrl))
}

/** Drop call rows whose recording or parent call is already on a dialer attempt. */
export function omitTwilioCallsAlreadyAttempted(
  calls: RecordingArchiveTarget[],
  attempts: RecordingArchiveTarget[],
): RecordingArchiveTarget[] {
  const recordingSids = new Set(attempts.map((row) => twilioRecordingSid(row.recordingSid)).filter((sid): sid is string => Boolean(sid)))
  const callSids = new Set(attempts.map((row) => twilioCallSid(row.callSid)).filter((sid): sid is string => Boolean(sid)))
  const seen = new Set<string>()
  const kept: RecordingArchiveTarget[] = []
  for (const call of oldestExpiringFirst(calls)) {
    const recordingSid = twilioRecordingSid(call.recordingSid)
    const callSid = twilioCallSid(call.callSid)
    if ((recordingSid && recordingSids.has(recordingSid)) || (callSid && callSids.has(callSid))) continue
    const key = recordingSid || callSid || call.id
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(call)
  }
  return kept
}

export async function readAllPages<T>(
  readPage: (offset: number, limit: number) => Promise<T[]>,
  pageSize = RECORDING_ARCHIVE_READ_PAGE,
): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; offset < 100_000; offset += pageSize) {
    const page = await readPage(offset, pageSize)
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
  return rows
}

export async function readBoundedAudio(response: Pick<Response, 'headers' | 'body'>): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RECORDING_BYTES) {
    await response.body?.cancel()
    throw new Error('recording_bytes_rejected')
  }
  if (!response.body) throw new Error('recording_bytes_rejected')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RECORDING_BYTES) throw new Error('recording_bytes_rejected')
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (total < MIN_RECORDING_BYTES) throw new Error('recording_bytes_rejected')
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** Oldest call time first. Mojo's retention window expires those copies first. */
export function oldestExpiringFirst(rows: RecordingArchiveTarget[]): RecordingArchiveTarget[] {
  return [...rows].sort((left, right) => recordingArchiveKey(left).localeCompare(recordingArchiveKey(right)))
}

export function planRecordingBackfill(
  rows: RecordingArchiveTarget[],
  input: { cursor?: string | null; limit?: number } = {},
): RecordingBackfillReport & { page: RecordingArchiveTarget[] } {
  const wouldArchive = emptyCounts()
  const alreadyStored = emptyCounts()
  let mojoCallsAwaitingUrl = 0
  const ready: RecordingArchiveTarget[] = []
  for (const row of rows) {
    if (row.storagePath) {
      addCount(alreadyStored, row.kind)
      continue
    }
    if (recordingSourceReady(row)) {
      addCount(wouldArchive, row.kind)
      ready.push(row)
      continue
    }
    if (row.kind === 'mojo_call' && row.isRecorded) mojoCallsAwaitingUrl += 1
  }
  const cursor = input.cursor || ''
  const limit = clampLimit(input.limit ?? RECORDING_ARCHIVE_PAGE_LIMIT)
  const page = oldestExpiringFirst(ready).filter((row) => recordingArchiveKey(row) > cursor).slice(0, limit)
  return {
    dryRun: true,
    wouldArchive,
    alreadyStored,
    mojoCallsAwaitingUrl,
    archived: 0,
    alreadyStoredThisRun: 0,
    skipped: 0,
    failed: 0,
    nextCursor: page.length ? recordingArchiveKey(page[page.length - 1]) : null,
    page,
  }
}

export async function applyRecordingPage(
  page: RecordingArchiveTarget[],
  deps: ArchiveDeps,
  rateLimitMs: number,
): Promise<Pick<RecordingBackfillReport, 'archived' | 'alreadyStoredThisRun' | 'skipped' | 'failed'>> {
  const result = { archived: 0, alreadyStoredThisRun: 0, skipped: 0, failed: 0 }
  let downloaded = 0
  for (const target of page) {
    if (target.storagePath) {
      result.alreadyStoredThisRun += 1
      continue
    }
    if (!recordingSourceReady(target)) {
      result.skipped += 1
      continue
    }
    if (downloaded > 0 && rateLimitMs > 0) await deps.sleep(rateLimitMs)
    try {
      const stored = await archiveOne(target, deps)
      downloaded += 1
      if (stored === 'already_stored') result.alreadyStoredThisRun += 1
      else result.archived += 1
    } catch {
      result.failed += 1
    }
  }
  return result
}

export async function archiveOne(
  target: RecordingArchiveTarget,
  deps: Pick<ArchiveDeps, 'downloadMojo' | 'downloadTwilio' | 'resolveCallRecording' | 'upload' | 'markStored' | 'now'>,
): Promise<'archived' | 'already_stored'> {
  if (target.storagePath) return 'already_stored'
  const sid = target.kind === 'twilio_attempt' || target.kind === 'twilio_call'
    ? await resolvedTwilioSid(target, deps)
    : null
  const storagePath = target.kind === 'twilio_attempt'
    ? twilioStoragePath({ leadId: target.leadId, attemptId: target.id, recordingSid: sid || '' })
    : target.kind === 'twilio_call'
      ? twilioCallStoragePath({ leadId: target.leadId, callId: target.id, recordingSid: sid || '' })
      : target.kind === 'mojo_event'
        ? mojoEventStoragePath(target.id)
        : mojoCallStoragePath(target.id)
  const bytes = sid
    ? await deps.downloadTwilio(sid)
    : await deps.downloadMojo(mojoRecordingSourceUrl(target.recordingUrl) || '', target.id)
  if (bytes.byteLength < MIN_RECORDING_BYTES || bytes.byteLength > MAX_RECORDING_BYTES) throw new Error('recording_bytes_rejected')
  const bucket = target.kind === 'twilio_attempt' || target.kind === 'twilio_call' ? RECORDINGS_BUCKET : MOJO_RECORDING_BUCKET
  await deps.upload(bucket, storagePath, bytes)
  const copiedAt = deps.now().toISOString()
  await deps.markStored(target, storagePath, copiedAt)
  target.storagePath = storagePath
  return 'archived'
}

export function attachMojoCallRecordingUrls(
  rows: RecordingArchiveTarget[],
  reportRows: readonly unknown[],
): number {
  const urls = new Map<string, string>()
  for (const row of reportRows) {
    const found = mojoRecordingUrlFromReportRow(row)
    if (found) urls.set(found.callId, found.url)
  }
  let attached = 0
  for (const row of rows) {
    if (row.kind !== 'mojo_call' || row.storagePath || mojoRecordingSourceUrl(row.recordingUrl)) continue
    const url = row.providerCallId ? urls.get(row.providerCallId) : null
    if (!url) continue
    row.recordingUrl = url
    attached += 1
  }
  return attached
}

type Db = ReturnType<typeof supabaseAdmin>

export async function runStoredRecordingBackfill(input: {
  apply?: boolean
  cursor?: string | null
  limit?: number
  providers?: RecordingArchiveKind[]
  rateLimitMs?: number
  sessionId?: string | null
  fetchImpl?: typeof fetch
  db?: Db
} = {}): Promise<RecordingBackfillReport> {
  const apply = input.apply === true
  const db = input.db ?? supabaseAdmin()
  const providers = new Set(input.providers ?? ['mojo_event', 'mojo_call', 'twilio_attempt', 'twilio_call'])
  const rows = (await loadArchiveRows(db)).filter((row) => providers.has(row.kind))
  if (apply && input.sessionId && providers.has('mojo_call')) {
    await fillMissingMojoCallUrls(db, rows, input.sessionId, input.fetchImpl ?? fetch)
  }
  const plan = planRecordingBackfill(rows, { cursor: input.cursor, limit: input.limit })
  const { page, ...report } = plan
  if (!apply) return report
  const applied = await applyRecordingPage(page, productionDeps(db), input.rateLimitMs ?? RECORDING_ARCHIVE_RATE_LIMIT_MS)
  return { ...report, ...applied, dryRun: false }
}

export async function archiveMojoRecordingsFromCron(input: {
  limit?: number
  sessionId?: string | null
} = {}): Promise<RecordingBackfillReport> {
  return runStoredRecordingBackfill({
    apply: true,
    limit: input.limit ?? 2,
    providers: ['mojo_event', 'mojo_call'],
    rateLimitMs: 500,
    sessionId: input.sessionId,
  })
}

export function twilioRecordingAuthorization(env: NodeJS.ProcessEnv = process.env): { accountSid: string; authorization: string } | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim() || ''
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) return null
  const authToken = env.TWILIO_AUTH_TOKEN?.trim()
  const apiKey = env.TWILIO_API_KEY?.trim()
  const apiSecret = env.TWILIO_API_SECRET?.trim()
  const user = apiKey && apiSecret ? apiKey : accountSid
  const secret = apiKey && apiSecret ? apiSecret : authToken
  if (!secret) return null
  return { accountSid, authorization: `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}` }
}

export async function storeDownloadedTwilioRecording(input: {
  recordingSid: string
  leadId: string | null
  filePath: string
}): Promise<'stored' | 'already_stored' | 'skipped'> {
  const sid = twilioRecordingSid(input.recordingSid)
  if (!sid) return 'skipped'
  try {
    const db = supabaseAdmin()
    const { data, error } = await db
      .from('dialer_session_attempts')
      .select('id,lead_id,recording_storage_path')
      .eq('recording_sid', sid)
      .limit(1)
      .maybeSingle()
    const info = await stat(input.filePath)
    if (info.size < MIN_RECORDING_BYTES || info.size > MAX_RECORDING_BYTES) return 'skipped'
    const bytes = new Uint8Array(await readFile(input.filePath))
    const deps = { ...productionDeps(db), downloadTwilio: async () => bytes }
    if (!error && data?.id) {
      if (typeof data.recording_storage_path === 'string' && data.recording_storage_path.trim()) return 'already_stored'
      await archiveOne({
        kind: 'twilio_attempt',
        id: data.id,
        recordedAt: new Date(0).toISOString(),
        leadId: typeof data.lead_id === 'string' ? data.lead_id : input.leadId,
        recordingUrl: null,
        recordingSid: sid,
        storagePath: null,
      }, deps)
      return 'stored'
    }
    const activity = await db
      .from('lead_activities')
      .select('id,lead_id,metadata,created_at')
      .in('activity_type', ['call', 'voicemail'])
      .or(`metadata->>recordingSid.ilike.${sid},metadata->>RecordingSid.ilike.${sid},metadata->>recording_sid.ilike.${sid}`)
      .limit(1)
      .maybeSingle()
    if (activity.error || !activity.data?.id) return 'skipped'
    const metadata = metadataRecord(activity.data.metadata)
    if (text(metadata.recording_storage_path)) return 'already_stored'
    const ids = recordingSidFromCallMetadata(metadata)
    await archiveOne({
      kind: 'twilio_call',
      id: activity.data.id,
      recordedAt: text(activity.data.created_at) || new Date(0).toISOString(),
      leadId: typeof activity.data.lead_id === 'string' ? activity.data.lead_id : input.leadId,
      recordingUrl: null,
      recordingSid: sid,
      callSid: ids.callSid,
      storagePath: null,
    }, deps)
    return 'stored'
  } catch {
    return 'skipped'
  }
}

function productionDeps(db: Db): ArchiveDeps {
  return {
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    downloadMojo: downloadMojoBytes,
    downloadTwilio: downloadTwilioBytes,
    resolveCallRecording: recordingSidForCall,
    upload: async (bucket, path, bytes) => {
      const { error } = await db.storage.from(bucket).upload(path, bytes, {
        contentType: 'audio/mpeg',
        cacheControl: '3600',
        upsert: true,
      })
      if (error) throw new Error('recording_upload_failed')
    },
    markStored: async (target, storagePath, copiedAt) => {
      if (target.kind === 'twilio_call') {
        const current = await db.from('lead_activities').select('metadata').eq('id', target.id).maybeSingle()
        if (current.error || !current.data) throw new Error('recording_path_write_failed')
        const metadata = metadataRecord(current.data.metadata)
        if (text(metadata.recording_storage_path)) return
        const { error } = await db.from('lead_activities').update({
          metadata: {
            ...metadata,
            recording_storage_path: storagePath,
            recording_copied_at: copiedAt,
            ...(target.recordingSid ? { recordingSid: target.recordingSid } : {}),
          },
        }).eq('id', target.id)
        if (error) throw new Error('recording_path_write_failed')
        return
      }
      const table = target.kind === 'twilio_attempt'
        ? 'dialer_session_attempts'
        : target.kind === 'mojo_event'
          ? 'crm_mojo_call_events'
          : 'crm_mojo_calls'
      const patch: Record<string, string> = {
        recording_storage_path: storagePath,
        recording_copied_at: copiedAt,
      }
      if (target.kind === 'mojo_call') {
        const url = mojoRecordingSourceUrl(target.recordingUrl)
        if (url) patch.recording_url = url
      }
      const { error } = await db.from(table).update(patch).eq('id', target.id).is('recording_storage_path', null)
      if (error) throw new Error('recording_path_write_failed')
    },
  }
}

async function resolvedTwilioSid(
  target: RecordingArchiveTarget,
  deps: Pick<ArchiveDeps, 'resolveCallRecording'>,
): Promise<string> {
  const existing = twilioRecordingSid(target.recordingSid)
  if (existing) return existing
  const callSid = twilioCallSid(target.callSid)
  if (!callSid || !deps.resolveCallRecording) throw new Error('twilio_recording_unavailable')
  const resolved = twilioRecordingSid(await deps.resolveCallRecording(callSid))
  if (!resolved) throw new Error('twilio_recording_unavailable')
  target.recordingSid = resolved
  return resolved
}

async function downloadMojoBytes(url: string, id: string): Promise<Uint8Array> {
  const filePath = await downloadRecording(url, id)
  try {
    const info = await stat(filePath)
    if (info.size < MIN_RECORDING_BYTES || info.size > MAX_RECORDING_BYTES) throw new Error('recording_bytes_rejected')
    return new Uint8Array(await readFile(filePath))
  } finally {
    await unlink(filePath).catch(() => undefined)
  }
}

async function downloadTwilioBytes(sid: string): Promise<Uint8Array> {
  const auth = twilioRecordingAuthorization()
  const recordingSid = twilioRecordingSid(sid)
  if (!auth || !recordingSid) throw new Error('twilio_recording_unavailable')
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${auth.accountSid}/Recordings/${recordingSid}.mp3`,
    { headers: { Authorization: auth.authorization }, signal: AbortSignal.timeout(30_000) },
  )
  if (!response.ok) throw new Error('twilio_recording_download_failed')
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    throw new Error('twilio_recording_download_failed')
  }
  return readBoundedAudio(response)
}

async function recordingSidForCall(callSid: string): Promise<string> {
  const auth = twilioRecordingAuthorization()
  const parent = twilioCallSid(callSid)
  if (!auth || !parent) throw new Error('twilio_recording_unavailable')
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${auth.accountSid}/Recordings.json?CallSid=${encodeURIComponent(parent)}&PageSize=1`,
    { headers: { Authorization: auth.authorization }, signal: AbortSignal.timeout(20_000) },
  )
  if (!response.ok) throw new Error('twilio_recording_download_failed')
  const payload = await response.json() as { recordings?: Array<{ sid?: unknown }> }
  const sid = twilioRecordingSid(payload.recordings?.[0]?.sid)
  if (!sid) throw new Error('twilio_recording_unavailable')
  return sid
}

async function loadArchiveRows(db: Db): Promise<RecordingArchiveTarget[]> {
  const [events, calls, attempts, activities] = await Promise.all([
    readAllPages((offset, limit) => pageRows(db, 'crm_mojo_call_events', 'call_at', offset, limit, (query) =>
      query.select('id,call_at,lead_id,recording_url,recording_storage_path').not('recording_url', 'is', null).is('recording_storage_path', null))),
    readAllPages((offset, limit) => pageRows(db, 'crm_mojo_calls', 'call_at', offset, limit, (query) =>
      query.select('id,call_at,lead_id,recording_url,recording_storage_path,is_recorded,provider_call_id').or('is_recorded.eq.true,recording_url.not.is.null').is('recording_storage_path', null))),
    readAllPages((offset, limit) => pageRows(db, 'dialer_session_attempts', 'created_at', offset, limit, (query) =>
      query.select('id,lead_id,recording_sid,provider_call_sid,recording_storage_path,ended_at,created_at').not('recording_sid', 'is', null).is('recording_storage_path', null))),
    readAllPages((offset, limit) => pageRows(db, 'lead_activities', 'created_at', offset, limit, (query) =>
      query.select('id,lead_id,metadata,created_at').in('activity_type', ['call', 'voicemail']).is('metadata->>recording_storage_path', null).or('metadata->>recordingSid.ilike.RE*,metadata->>RecordingSid.ilike.RE*,metadata->>recording_sid.ilike.RE*,metadata->>recordingUrl.ilike.*/api/recordings/RE*,metadata->>recordingUrl.ilike.*Recordings/RE*,metadata->>source.eq.twilio_recording_callback'))),
  ])
  const attemptRows = attempts.map((row) => ({
    kind: 'twilio_attempt' as const,
    id: String(row.id),
    recordedAt: text(row.ended_at) || text(row.created_at) || new Date(0).toISOString(),
    leadId: text(row.lead_id),
    recordingUrl: null,
    recordingSid: text(row.recording_sid),
    callSid: text(row.provider_call_sid),
    storagePath: text(row.recording_storage_path),
  }))
  const callRows = omitTwilioCallsAlreadyAttempted(activities.flatMap((row) => {
    const ids = recordingSidFromCallMetadata(row.metadata)
    if (!ids.recordingSid && !ids.callSid) return []
    return [{
      kind: 'twilio_call' as const,
      id: String(row.id),
      recordedAt: text(row.created_at) || new Date(0).toISOString(),
      leadId: text(row.lead_id),
      recordingUrl: null,
      recordingSid: ids.recordingSid,
      callSid: ids.callSid,
      storagePath: text(metadataRecord(row.metadata).recording_storage_path),
    }]
  }), attemptRows)
  return [
    ...events.map((row) => ({
      kind: 'mojo_event' as const,
      id: String(row.id),
      recordedAt: text(row.call_at) || new Date(0).toISOString(),
      leadId: text(row.lead_id),
      recordingUrl: text(row.recording_url),
      recordingSid: null,
      storagePath: text(row.recording_storage_path),
    })),
    ...calls.map((row) => ({
      kind: 'mojo_call' as const,
      id: String(row.id),
      recordedAt: text(row.call_at) || new Date(0).toISOString(),
      leadId: text(row.lead_id),
      recordingUrl: text(row.recording_url),
      recordingSid: null,
      storagePath: text(row.recording_storage_path),
      isRecorded: row.is_recorded === true,
      providerCallId: text(row.provider_call_id),
    })),
    ...attemptRows,
    ...callRows,
  ]
}

async function pageRows(
  db: Db,
  table: string,
  orderColumn: string,
  offset: number,
  limit: number,
  // select() narrows the Supabase builder, so one alias cannot name every table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filter: (query: any) => any,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await filter(db.from(table))
    .order(orderColumn, { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) throw new Error('recording_archive_query_failed')
  return (data ?? []) as Array<Record<string, unknown>>
}

async function fillMissingMojoCallUrls(
  db: Db,
  rows: RecordingArchiveTarget[],
  sessionId: string,
  fetchImpl: typeof fetch,
) {
  const waiting = oldestExpiringFirst(rows.filter((row) =>
    row.kind === 'mojo_call' && row.isRecorded && !row.storagePath && !mojoRecordingSourceUrl(row.recordingUrl)))
  const dates = [...new Set(waiting.slice(0, RECORDING_ARCHIVE_PAGE_LIMIT).map((row) => {
    try {
      return centralDateString(new Date(row.recordedAt))
    } catch {
      return ''
    }
  }).filter(Boolean))].slice(0, 3)
  const reportRows: unknown[] = []
  for (const date of dates) {
    reportRows.push(...await fetchMojoRecordingReport(sessionId, date, fetchImpl))
  }
  const before = new Map(rows.map((row) => [`${row.kind}:${row.id}`, row.recordingUrl]))
  if (!attachMojoCallRecordingUrls(rows, reportRows)) return
  for (const row of rows) {
    const url = mojoRecordingSourceUrl(row.recordingUrl)
    if (row.kind !== 'mojo_call' || !url || before.get(`${row.kind}:${row.id}`) === row.recordingUrl) continue
    await db.from('crm_mojo_calls').update({ recording_url: url }).eq('id', row.id).is('recording_url', null)
  }
}

async function fetchMojoRecordingReport(sessionId: string, date: string, fetchImpl: typeof fetch): Promise<unknown[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !sessionId.trim()) return []
  try {
    const response = await fetchImpl(
      `${MOJO_BASE}${MOJO_REPORT_PATH}?agents=%5B-1%5D&date_range=custom&from=${date}&to=${date}`,
      {
        headers: {
          accept: 'application/json, text/plain, */*',
          cookie: `sessionid=${sessionId}`,
          referer: `${MOJO_BASE}/`,
        },
        signal: AbortSignal.timeout(20_000),
      },
    )
    if (!response.ok) return []
    const payload = await response.json() as { recordings?: unknown }
    return Array.isArray(payload.recordings) ? payload.recordings : []
  } catch {
    return []
  }
}

function clampLimit(value: number): number {
  if (!Number.isInteger(value)) return RECORDING_ARCHIVE_PAGE_LIMIT
  return Math.min(RECORDING_ARCHIVE_PAGE_LIMIT, Math.max(1, value))
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
