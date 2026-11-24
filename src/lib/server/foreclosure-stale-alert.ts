import { Resend } from 'resend'
import { chicagoDate, type IngestControl } from '@/lib/prospecting/foreclosure'
import { serviceAreaPlace } from '@/lib/prospecting/foreclosure-service-area'
import { ForeclosureError } from '@/lib/server/foreclosure-prospects'
import { supabase } from '@/lib/supabase-lazy'

const TABLE = 'mortgage_foreclosure_prospects'
const STALE_MS = 24 * 60 * 60 * 1000
const DEFAULT_ALERT_TO = 'ernest@savingkc.com'
const DEFAULT_ALERT_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000

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

export function isChicagoWeekday(now = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
  }).format(now)
  return weekday !== 'Sat' && weekday !== 'Sun'
}

export function laterIso(left: string | null, right: string | null): string | null {
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

export function countyLabel(county: string, state: string): string {
  const name = county ? county.charAt(0).toUpperCase() + county.slice(1) : 'County'
  return state ? `${name} ${state}` : name
}

function formatCountyAge(ageMs: number | null): string {
  if (ageMs == null) return 'unknown (no county activity)'
  return `${(ageMs / 3_600_000).toFixed(1)}h`
}

export function alertCounties(counties: ForeclosureStaleCounty[]): ForeclosureStaleCounty[] {
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
