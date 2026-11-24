import { Resend } from 'resend'
import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  FIRST_FORECLOSURE_COUNTIES,
  FORECLOSURE_NOTICE_TYPES,
  chicagoDate,
  type ForeclosureNoticeType,
  type IngestControl,
  scrapeUpdatedSince,
} from '@/lib/prospecting/foreclosure'
import {
  listForeclosureIngestControls,
  setForeclosureIngestControl,
} from '@/lib/server/foreclosure-ingest'
import { ForeclosureError, importForeclosureCsv } from '@/lib/server/foreclosure-prospects'
import { serviceAreaPlace } from '@/lib/prospecting/foreclosure-service-area'
import { fetchCountyPublicCsv } from '@/lib/server/foreclosure-county-public'
import { supabase } from '@/lib/supabase-lazy'

const TABLE = 'mortgage_foreclosure_prospects'
const STALE_MS = 24 * 60 * 60 * 1000
const DEFAULT_ALERT_TO = 'ernest@savingkc.com'
const DEFAULT_ALERT_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000

export type ForeclosureFreshness = {
  newestCreatedAt: string | null
  newestUpdatedAt: string | null
  ageMs: number | null
  stale: boolean
  chicagoWeekday: boolean
  chicagoDate: string
  prospectCount: number
}

/** One public-source outcome for a county. salesCount null means this run did not observe that feed. */
export type ForeclosureCountyProviderSignal = {
  county: string
  state: string
  lastError: string | null
  salesCount: number | null
}

export type ForeclosureCountyActivity = {
  county: string
  state: string
  paused: boolean
  newestCreatedAt: string | null
  newestUpdatedAt?: string | null
  /** Latest unpaused control updated_since. Used only when this county has no prospect timestamps. */
  watermarkAt?: string | null
  lastError?: string | null
  salesCount?: number | null
}

export type ForeclosureStaleCounty = {
  county: string
  state: string
  paused: boolean
  newestCreatedAt: string | null
  newestUpdatedAt: string | null
  watermarkAt: string | null
  ageMs: number | null
  stale: boolean
  lastError: string | null
  salesCount: number | null
  dark: boolean
}

export type ForeclosureStaleAlertResult = {
  warranted: boolean
  sent: boolean
  skippedReason: string | null
  to: string | null
  counties: ForeclosureStaleCounty[]
}

export type ForeclosureProviderStatus =
  | {
      status: 'ready'
      provider: 'county_public' | 'csv_url'
      csv: string
      source: string
      sourceNotes?: string[]
    }
  | {
      status: 'not_configured'
      provider: string
      reason: string
      missingSecrets: string[]
      documentedSecrets: string[]
      sourceNotes?: string[]
    }
  | {
      status: 'error'
      provider: string
      reason: string
      sourceNotes?: string[]
    }

export type ForeclosureDailyIngestResult = {
  ok: boolean
  ranAt: string
  chicagoDate: string
  freshness: ForeclosureFreshness
  controls: IngestControl[]
  seededControls: number
  provider: ForeclosureProviderStatus
  import: null | {
    imported: number
    rejected: number
    warnings: number
    source: string
  }
  watermarksAdvanced: Array<{ county: string; noticeType: ForeclosureNoticeType; updatedSince: string }>
  staleAlert: ForeclosureStaleAlertResult
  notes: string[]
}

type ResolvedForeclosureProvider = ForeclosureProviderStatus & {
  countySignals: ForeclosureCountyProviderSignal[]
}

/** System actor for cron/CSV drops. Never invents a human identity. */
export function foreclosureCronActor(): AuthenticatedActor {
  const email = (process.env.FORECLOSURE_INGEST_ACTOR_EMAIL || 'foreclosure-cron@savingkc.com').trim().toLowerCase()
  return { email, name: 'Foreclosure daily ingest' }
}

export function isChicagoWeekday(now = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
  }).format(now)
  return weekday !== 'Sat' && weekday !== 'Sun'
}

export function evaluateForeclosureStale(input: {
  newestCreatedAt: string | null
  newestUpdatedAt?: string | null
  now?: Date
  thresholdMs?: number
}): { ageMs: number | null; stale: boolean; chicagoWeekday: boolean } {
  const now = input.now ?? new Date()
  const thresholdMs = input.thresholdMs ?? STALE_MS
  const chicagoWeekday = isChicagoWeekday(now)
  if (!input.newestCreatedAt) {
    // Empty table is stale on weekdays so the owner knows the portal never started ingesting.
    return { ageMs: null, stale: chicagoWeekday, chicagoWeekday }
  }
  const activity = laterIso(input.newestCreatedAt, input.newestUpdatedAt ?? null)
  const created = activity ? Date.parse(activity) : NaN
  if (!Number.isFinite(created)) {
    return { ageMs: null, stale: chicagoWeekday, chicagoWeekday }
  }
  const ageMs = Math.max(0, now.getTime() - created)
  // Weekend: log freshness but do not page. Activity is the later of created_at and updated_at
  // so a county_public upsert counts as a landing even when the row already existed.
  const stale = chicagoWeekday && ageMs >= thresholdMs
  return { ageMs, stale, chicagoWeekday }
}

function laterIso(left: string | null, right: string | null): string | null {
  const leftMs = left ? Date.parse(left) : NaN
  const rightMs = right ? Date.parse(right) : NaN
  if (!Number.isFinite(leftMs) && !Number.isFinite(rightMs)) return null
  if (!Number.isFinite(rightMs)) return left
  if (!Number.isFinite(leftMs)) return right
  return leftMs >= rightMs ? left : right
}

/**
 * Per-county freshness for unpaused ingest controls.
 * Activity is the later of that county's newest prospect created_at and updated_at.
 * The control watermark is only a fallback when the county has no prospect timestamps:
 * the cron advances every unpaused watermark after any import, so a Jackson write must
 * not mark Johnson fresh. A provider dark signal (fetch error, HTTP 404, or 0 sales on
 * that county's sales feed) is stale on a Chicago weekday even when activity is recent.
 * Paused counties and weekends are never stale.
 */
export function evaluateForeclosureCounties(input: {
  counties: ForeclosureCountyActivity[]
  now?: Date
  thresholdMs?: number
}): { chicagoWeekday: boolean; chicagoDate: string; counties: ForeclosureStaleCounty[]; warranted: boolean } {
  const now = input.now ?? new Date()
  const thresholdMs = input.thresholdMs ?? STALE_MS
  const chicagoWeekday = isChicagoWeekday(now)
  const counties = input.counties
    .map((county) => evaluateForeclosureCounty(county, now, thresholdMs, chicagoWeekday))
    .sort((left, right) => left.county.localeCompare(right.county) || left.state.localeCompare(right.state))
  const warranted = counties.some((county) => county.stale)
  return { chicagoWeekday, chicagoDate: chicagoDate(now), counties, warranted }
}

function evaluateForeclosureCounty(
  county: ForeclosureCountyActivity,
  now: Date,
  thresholdMs: number,
  chicagoWeekday: boolean,
): ForeclosureStaleCounty {
  const newestUpdatedAt = county.newestUpdatedAt ?? null
  const watermarkAt = county.watermarkAt ?? null
  const lastError = county.lastError?.trim() || null
  const salesCount = typeof county.salesCount === 'number' ? county.salesCount : null
  const dark = Boolean(lastError) || salesCount === 0
  const prospectActivity = laterIso(county.newestCreatedAt, newestUpdatedAt)
  const activityAt = prospectActivity ?? (watermarkAt && Number.isFinite(Date.parse(watermarkAt)) ? watermarkAt : null)
  const parsed = activityAt ? Date.parse(activityAt) : NaN
  const ageMs = Number.isFinite(parsed) ? Math.max(0, now.getTime() - parsed) : null
  const agedOut = ageMs == null || ageMs >= thresholdMs
  const stale = !county.paused && chicagoWeekday && (dark || agedOut)
  return {
    county: county.county,
    state: county.state,
    paused: county.paused,
    newestCreatedAt: county.newestCreatedAt,
    newestUpdatedAt,
    watermarkAt,
    ageMs,
    stale,
    lastError,
    salesCount,
    dark,
  }
}

/** Counties with at least one unpaused control. Missing controls stay paused and are omitted. */
export function activeForeclosureCounties(controls: IngestControl[]): Array<{ county: string; state: string; watermarkAt: string | null }> {
  const grouped = new Map<string, { county: string; state: string; watermarkAt: string | null }>()
  for (const control of controls) {
    if (control.paused) continue
    const place = serviceAreaPlace(control.county)
    if (!place) continue
    const key = `${place.county}:${place.state}`
    const current = grouped.get(key)
    grouped.set(key, {
      county: place.county,
      state: place.state,
      watermarkAt: laterIso(current?.watermarkAt ?? null, control.updatedSince),
    })
  }
  return [...grouped.values()].sort((left, right) => left.county.localeCompare(right.county) || left.state.localeCompare(right.state))
}

/**
 * Dark signals from one county_public pull.
 * Johnson sales are JoCo GetAllSales. Jackson sales are the SouthLaw Missouri report.
 * Zero sales is dark only when that feed did not already fail; a 404 stays the last error.
 */
export function foreclosureCountyProviderSignals(input: {
  errors: string[]
  stats: { jocoSales: number; southlawJackson: number }
}): ForeclosureCountyProviderSignal[] {
  const errors = input.errors.map((error) => error.trim()).filter(Boolean)
  const jocoErrors = errors.filter((error) => /^joco\b/i.test(error))
  const johnsonParts = [
    ...jocoErrors,
    ...errors.filter((error) => /^(southlaw_ks|legal_record)\b/i.test(error)),
  ]
  if (jocoErrors.length === 0 && input.stats.jocoSales === 0) johnsonParts.push('joco returned 0 sales')
  const southlawMoErrors = errors.filter((error) => /^southlaw_mo\b/i.test(error))
  const jacksonParts = [
    ...southlawMoErrors,
    ...errors.filter((error) => /^notice_registry\b/i.test(error)),
  ]
  if (southlawMoErrors.length === 0 && input.stats.southlawJackson === 0) jacksonParts.push('southlaw_mo returned 0 sales')
  return [
    { county: 'johnson', state: 'KS', lastError: joinCountyErrors(johnsonParts), salesCount: input.stats.jocoSales },
    { county: 'jackson', state: 'MO', lastError: joinCountyErrors(jacksonParts), salesCount: input.stats.southlawJackson },
  ]
}

function joinCountyErrors(parts: string[]): string | null {
  if (!parts.length) return null
  return parts.join('; ').slice(0, 500)
}

export async function getForeclosureFreshness(now = new Date()): Promise<ForeclosureFreshness> {
  const newest = await supabase
    .from(TABLE)
    .select('created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(1)
  if (newest.error) {
    const detail = `${newest.error.message || ''} ${newest.error.code || ''}`.toLowerCase()
    if (detail.includes('42p01') || detail.includes('does not exist') || detail.includes('pgrst205')) {
      throw new ForeclosureError('foreclosure_unavailable', 503, 'Foreclosure storage is not available in this environment yet.')
    }
    throw new ForeclosureError('foreclosure_unavailable', 503, 'Foreclosure freshness could not be read.')
  }

  const counted = await supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
  if (counted.error) {
    const detail = `${counted.error.message || ''} ${counted.error.code || ''}`.toLowerCase()
    if (detail.includes('42p01') || detail.includes('does not exist') || detail.includes('pgrst205')) {
      throw new ForeclosureError('foreclosure_unavailable', 503, 'Foreclosure storage is not available in this environment yet.')
    }
    throw new ForeclosureError('foreclosure_unavailable', 503, 'Foreclosure freshness could not be read.')
  }

  const updated = await supabase
    .from(TABLE)
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
  if (updated.error) {
    throw new ForeclosureError('foreclosure_unavailable', 503, 'Foreclosure freshness could not be read.')
  }
  const row = (newest.data?.[0] ?? null) as { created_at?: string; updated_at?: string } | null
  const updatedRow = (updated.data?.[0] ?? null) as { updated_at?: string } | null
  const newestCreatedAt = typeof row?.created_at === 'string' ? row.created_at : null
  const newestUpdatedAt = typeof updatedRow?.updated_at === 'string'
    ? updatedRow.updated_at
    : (typeof row?.updated_at === 'string' ? row.updated_at : null)
  const evaluated = evaluateForeclosureStale({ newestCreatedAt, newestUpdatedAt, now })
  return {
    newestCreatedAt,
    newestUpdatedAt,
    ageMs: evaluated.ageMs,
    stale: evaluated.stale,
    chicagoWeekday: evaluated.chicagoWeekday,
    chicagoDate: chicagoDate(now),
    prospectCount: typeof counted.count === 'number' ? counted.count : 0,
  }
}

async function readCountyProspectActivity(county: string, state: string): Promise<{ newestCreatedAt: string | null; newestUpdatedAt: string | null }> {
  const created = await supabase
    .from(TABLE)
    .select('created_at')
    .eq('county', county)
    .eq('state', state)
    .order('created_at', { ascending: false })
    .limit(1)
  if (created.error) throw countyFreshnessError(created.error)
  const updated = await supabase
    .from(TABLE)
    .select('updated_at')
    .eq('county', county)
    .eq('state', state)
    .order('updated_at', { ascending: false })
    .limit(1)
  if (updated.error) throw countyFreshnessError(updated.error)
  const createdRow = (created.data?.[0] ?? null) as { created_at?: string } | null
  const updatedRow = (updated.data?.[0] ?? null) as { updated_at?: string } | null
  return {
    newestCreatedAt: typeof createdRow?.created_at === 'string' ? createdRow.created_at : null,
    newestUpdatedAt: typeof updatedRow?.updated_at === 'string' ? updatedRow.updated_at : null,
  }
}

function countyFreshnessError(error: { message?: string; code?: string } | null | undefined): ForeclosureError {
  const detail = `${error?.message || ''} ${error?.code || ''}`.toLowerCase()
  if (detail.includes('42p01') || detail.includes('does not exist') || detail.includes('pgrst205')) {
    return new ForeclosureError('foreclosure_unavailable', 503, 'Foreclosure storage is not available in this environment yet.')
  }
  return new ForeclosureError('foreclosure_unavailable', 503, 'Foreclosure freshness could not be read.')
}

export async function loadForeclosureCountyActivity(input: {
  controls: IngestControl[]
  signals?: ForeclosureCountyProviderSignal[]
}): Promise<ForeclosureCountyActivity[]> {
  const signals = new Map((input.signals ?? []).map((signal) => [`${signal.county}:${signal.state}`, signal]))
  const rows: ForeclosureCountyActivity[] = []
  for (const place of activeForeclosureCounties(input.controls)) {
    const activity = await readCountyProspectActivity(place.county, place.state)
    const signal = signals.get(`${place.county}:${place.state}`)
    rows.push({
      county: place.county,
      state: place.state,
      paused: false,
      newestCreatedAt: activity.newestCreatedAt,
      newestUpdatedAt: activity.newestUpdatedAt,
      watermarkAt: place.watermarkAt,
      lastError: signal?.lastError ?? null,
      salesCount: signal?.salesCount ?? null,
    })
  }
  return rows
}

/**
 * Seed default ingest watermark rows for first counties × notice types.
 * Does not invent PropStream endpoints — only ensures the control plane exists.
 */
export async function ensureForeclosureIngestControls(actor: AuthenticatedActor): Promise<{ controls: IngestControl[]; seeded: number }> {
  const existing = await listForeclosureIngestControls()
  const existingKeys = new Set(existing.map((row) => `${row.county}:${row.noticeType}`))
  let seeded = 0
  for (const county of FIRST_FORECLOSURE_COUNTIES) {
    for (const noticeType of FORECLOSURE_NOTICE_TYPES) {
      const key = `${county.county}:${noticeType}`
      if (existingKeys.has(key)) continue
      // Persist defaults so paused / updated_since can be managed in the UI.
      await setForeclosureIngestControl(actor, {
        county: county.county,
        noticeType,
        paused: false,
        updatedSince: null,
      })
      seeded += 1
    }
  }
  return { controls: await listForeclosureIngestControls(), seeded }
}

/**
 * County public filing pull. No PropStream client and no owner CSV upload.
 * Optional override: FORECLOSURE_INGEST_PROVIDER=csv_url plus FORECLOSURE_INGEST_CSV_URL,
 * or a CSV body on POST, for a one-off replay. That is not the daily path.
 */
export async function resolveForeclosureIngestProvider(input?: {
  csvBody?: string | null
  now?: Date
}): Promise<ResolvedForeclosureProvider> {
  const documentedSecrets = [
    'CRON_SECRET',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'FORECLOSURE_STALE_ALERT_TO',
    'FORECLOSURE_STALE_ALERT_MIN_INTERVAL_HOURS',
    'FORECLOSURE_INGEST_ACTOR_EMAIL',
    'FORECLOSURE_NR_PAGE_CAP',
  ]

  if (typeof input?.csvBody === 'string' && input.csvBody.trim()) {
    return {
      status: 'ready',
      provider: 'csv_url',
      csv: input.csvBody,
      source: 'request_body',
      countySignals: [],
    }
  }

  const provider = (process.env.FORECLOSURE_INGEST_PROVIDER || '').trim().toLowerCase() || 'county_public'
  if (provider === 'propstream') {
    return {
      status: 'not_configured',
      provider: 'propstream',
      reason: 'PropStream is not a foreclosure ingest provider. This repo has no PropStream API client and will not invent one. Daily ingest is county_public. PropStream may be used later for equity only. MLS/Matrix is value and comps only.',
      missingSecrets: [],
      documentedSecrets,
      countySignals: [],
    }
  }

  if (provider === 'csv_url') {
    const csvUrl = (process.env.FORECLOSURE_INGEST_CSV_URL || '').trim()
    if (!csvUrl) {
      return {
        status: 'not_configured',
        provider: 'csv_url',
        reason: 'FORECLOSURE_INGEST_PROVIDER=csv_url but FORECLOSURE_INGEST_CSV_URL is empty. Daily ingest should stay on county_public.',
        missingSecrets: ['FORECLOSURE_INGEST_CSV_URL'],
        documentedSecrets,
        countySignals: [],
      }
    }
    try {
      const response = await fetch(csvUrl, {
        headers: { Accept: 'text/csv,text/plain,*/*' },
        signal: AbortSignal.timeout(25_000),
        cache: 'no-store',
      })
      if (!response.ok) {
        return { status: 'error', provider: 'csv_url', reason: `CSV drop URL returned HTTP ${response.status}.`, countySignals: [] }
      }
      const csv = await response.text()
      if (!csv.trim()) return { status: 'error', provider: 'csv_url', reason: 'CSV drop URL returned an empty body.', countySignals: [] }
      return { status: 'ready', provider: 'csv_url', csv, source: csvUrl, countySignals: [] }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'csv_url_fetch_failed'
      return { status: 'error', provider: 'csv_url', reason: message.slice(0, 300), countySignals: [] }
    }
  }

  const pulled = await fetchCountyPublicCsv({ now: input?.now })
  const countySignals = foreclosureCountyProviderSignals({ errors: pulled.errors, stats: pulled.stats })
  if (!pulled.ok && pulled.stats.importable === 0 && pulled.errors.length >= 4) {
    return {
      status: 'error',
      provider: 'county_public',
      reason: pulled.errors.slice(0, 4).join('; ') || 'county_public sources failed',
      sourceNotes: pulled.notes,
      countySignals,
    }
  }
  if (pulled.stats.importable === 0) {
    return {
      status: 'not_configured',
      provider: 'county_public',
      reason: 'County public sources ran but produced no owner+situs rows to import. JoCo sales without a SouthLaw address and Legal Record MF lines without a case match are skipped. mopublicnotices still needs computerUse.',
      missingSecrets: [],
      documentedSecrets,
      sourceNotes: pulled.notes,
      countySignals,
    }
  }
  return {
    status: 'ready',
    provider: 'county_public',
    csv: pulled.csv,
    source: 'county_public',
    sourceNotes: pulled.notes,
    countySignals,
  }
}

export async function advanceForeclosureWatermarks(
  actor: AuthenticatedActor,
  controls: IngestControl[],
  now = new Date(),
): Promise<Array<{ county: string; noticeType: ForeclosureNoticeType; updatedSince: string }>> {
  const stamp = now.toISOString()
  const advanced: Array<{ county: string; noticeType: ForeclosureNoticeType; updatedSince: string }> = []
  for (const control of controls) {
    if (control.paused) continue
    await setForeclosureIngestControl(actor, {
      county: control.county,
      noticeType: control.noticeType,
      paused: false,
      updatedSince: stamp,
    })
    advanced.push({ county: control.county, noticeType: control.noticeType, updatedSince: stamp })
  }
  return advanced
}

function alertMinIntervalMs(): number {
  const raw = Number(process.env.FORECLOSURE_STALE_ALERT_MIN_INTERVAL_HOURS)
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw * 60 * 60 * 1000)
  return DEFAULT_ALERT_MIN_INTERVAL_MS
}

/**
 * Overall throttle for the one email that lists every stale county.
 * Not per county: a second county going dark inside the window waits for the next send.
 * Default gap is 20h (FORECLOSURE_STALE_ALERT_MIN_INTERVAL_HOURS), and the dedupe is in-process only.
 */
let lastStaleAlertAtMs = 0

export function resetForeclosureStaleAlertDedupeForTests() {
  lastStaleAlertAtMs = 0
}

function countyLabel(county: string, state: string): string {
  const name = county ? county.charAt(0).toUpperCase() + county.slice(1) : 'County'
  return state ? `${name} ${state}` : name
}

function formatCountyAge(ageMs: number | null): string {
  if (ageMs == null) return 'unknown (no county activity)'
  return `${(ageMs / 3_600_000).toFixed(1)}h`
}

function alertCounties(counties: ForeclosureStaleCounty[]): ForeclosureStaleCounty[] {
  return counties.filter((county) => !county.paused)
}

export async function sendForeclosureStaleAlert(input: {
  counties: ForeclosureStaleCounty[]
  notes: string[]
  chicagoDate: string
  chicagoWeekday: boolean
  force?: boolean
}): Promise<ForeclosureStaleAlertResult> {
  const to = (process.env.FORECLOSURE_STALE_ALERT_TO || DEFAULT_ALERT_TO).trim().toLowerCase()
  const counties = alertCounties(input.counties)
  if (counties.length === 0) {
    return { warranted: false, sent: false, skippedReason: 'all_paused', to, counties: [] }
  }
  if (!input.chicagoWeekday && !input.force) {
    return { warranted: false, sent: false, skippedReason: 'weekend', to, counties }
  }
  const stale = counties.filter((county) => county.stale)
  if (stale.length === 0 && !input.force) {
    return { warranted: false, sent: false, skippedReason: 'not_stale', to, counties }
  }

  const now = Date.now()
  if (!input.force && lastStaleAlertAtMs && now - lastStaleAlertAtMs < alertMinIntervalMs()) {
    return { warranted: true, sent: false, skippedReason: 'min_interval', to, counties }
  }

  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.RESEND_FROM_EMAIL?.trim()
  if (!apiKey || !from) {
    console.warn('[foreclosure-daily-ingest] stale alert skipped: RESEND_API_KEY / RESEND_FROM_EMAIL missing', {
      counties: stale.map((county) => county.county),
    })
    return { warranted: true, sent: false, skippedReason: 'resend_not_configured', to, counties }
  }

  const labels = stale.map((county) => countyLabel(county.county, county.state))
  const subject = labels.length === 1
    ? `Foreclosure portal stale — ${labels[0]}`
    : `Foreclosure portal stale — ${labels.length} counties`
  const lines = stale.map((county) => (
    `- ${countyLabel(county.county, county.state)}: age ${formatCountyAge(county.ageMs)}; newest created_at ${county.newestCreatedAt ?? '(none)'}; last error: ${county.lastError ?? '(none)'}`
  ))
  const body = [
    'Saving KC CRM foreclosure daily ingest',
    '',
    `Chicago date: ${input.chicagoDate}`,
    `Stale counties: ${labels.join(', ')}`,
    ...lines,
    '',
    'Throttle: one email for every stale county, not one email per county.',
    '',
    'Portal: https://crm.savingkc.com/prospecting/foreclosure',
    '',
    'Notes:',
    ...(input.notes.length ? input.notes.map((note) => `- ${note}`) : ['- (none)']),
    '',
    'This alert fails soft and never sends SMS. Paused counties are omitted. A fetch error, HTTP 404, or 0 sales on a county sales feed is stale on a Chicago weekday even when another county is fresh.',
  ].join('\n')

  try {
    const resend = new Resend(apiKey)
    const result = await resend.emails.send({
      from: `Saving KC CRM <${from}>`,
      to: [to],
      subject,
      text: body,
    })
    if (result.error) {
      console.error('[foreclosure-daily-ingest] stale alert Resend error', {
        message: result.error.message?.slice(0, 300),
      })
      return { warranted: true, sent: false, skippedReason: 'resend_error', to, counties }
    }
    lastStaleAlertAtMs = now
    return { warranted: true, sent: true, skippedReason: null, to, counties }
  } catch (error) {
    console.error('[foreclosure-daily-ingest] stale alert failed soft', {
      message: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
    })
    return { warranted: true, sent: false, skippedReason: 'resend_exception', to, counties }
  }
}

export async function runForeclosureDailyIngest(input?: {
  csvBody?: string | null
  now?: Date
  skipAlert?: boolean
}): Promise<ForeclosureDailyIngestResult> {
  const now = input?.now ?? new Date()
  const actor = foreclosureCronActor()
  const notes: string[] = []

  const { controls, seeded } = await ensureForeclosureIngestControls(actor)
  if (seeded > 0) notes.push(`Seeded ${seeded} ingest control row(s) for jackson/johnson × notice types.`)

  const activeControls = controls.filter((control) => !control.paused)
  const paused = controls.filter((control) => control.paused)
  if (paused.length) {
    notes.push(`Paused controls skipped: ${paused.map((c) => `${c.county}/${c.noticeType}`).join(', ')}`)
  }
  for (const control of activeControls) {
    const watermark = scrapeUpdatedSince(control)
    if (watermark) notes.push(`Watermark ${control.county}/${control.noticeType}=${watermark}`)
  }

  const resolved = await resolveForeclosureIngestProvider({ csvBody: input?.csvBody, now })
  const { countySignals, ...provider } = resolved
  let importResult: ForeclosureDailyIngestResult['import'] = null
  let watermarksAdvanced: ForeclosureDailyIngestResult['watermarksAdvanced'] = []

  if (provider.sourceNotes?.length) notes.push(...provider.sourceNotes)
  if (provider.status === 'ready') {
    if (activeControls.length === 0) {
      notes.push('All ingest controls are paused — county rows were not imported.')
    } else {
      const imported = await importForeclosureCsv(actor, provider.csv)
      importResult = {
        imported: imported.imported,
        rejected: imported.rejected.length,
        warnings: imported.warnings.length,
        source: provider.source,
      }
      notes.push(`Imported ${imported.imported} row(s) via ${provider.source}; rejected ${imported.rejected.length}.`)
      if (imported.imported > 0) {
        watermarksAdvanced = await advanceForeclosureWatermarks(actor, activeControls, now)
        notes.push(`Advanced ${watermarksAdvanced.length} watermark(s).`)
      }
    }
  } else if (provider.status === 'not_configured') {
    notes.push(provider.reason)
    notes.push(`Missing: ${provider.missingSecrets.join(', ') || 'n/a'}`)
  } else {
    notes.push(`Provider error (${provider.provider}): ${provider.reason}`)
  }

  const freshness = await getForeclosureFreshness(now)
  if (freshness.stale) {
    notes.push(`Freshness STALE — newest created_at ${freshness.newestCreatedAt ?? '(none)'}`)
  } else {
    notes.push(`Freshness ok — newest created_at ${freshness.newestCreatedAt ?? '(none)'}`)
  }

  const countyReport = evaluateForeclosureCounties({
    counties: await loadForeclosureCountyActivity({ controls, signals: countySignals }),
    now,
  })
  const staleNames = countyReport.counties.filter((county) => county.stale).map((county) => countyLabel(county.county, county.state))
  if (countyReport.counties.length === 0) {
    notes.push('All ingest controls are paused — no county stale alert.')
  } else if (staleNames.length) {
    notes.push(`Stale counties: ${staleNames.join(', ')}`)
  } else if (countyReport.chicagoWeekday) {
    notes.push('Unpaused counties are inside the freshness window.')
  } else {
    notes.push('Weekend — county stale alert skipped.')
  }

  const staleAlert: ForeclosureStaleAlertResult = input?.skipAlert
    ? {
        warranted: countyReport.warranted,
        sent: false,
        skippedReason: 'skip_alert_flag',
        to: null,
        counties: alertCounties(countyReport.counties),
      }
    : await sendForeclosureStaleAlert({
        counties: countyReport.counties,
        notes,
        chicagoDate: countyReport.chicagoDate,
        chicagoWeekday: countyReport.chicagoWeekday,
      })

  const ok = provider.status !== 'error' && (importResult == null || importResult.imported >= 0)
  return {
    ok,
    ranAt: now.toISOString(),
    chicagoDate: chicagoDate(now),
    freshness,
    controls: await listForeclosureIngestControls(),
    seededControls: seeded,
    provider,
    import: importResult,
    watermarksAdvanced,
    staleAlert,
    notes,
  }
}
