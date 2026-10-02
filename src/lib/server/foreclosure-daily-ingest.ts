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

export type ForeclosureProviderStatus =
  | {
      status: 'ready'
      provider: 'csv_url'
      csv: string
      source: string
    }
  | {
      status: 'not_configured'
      provider: string
      reason: string
      missingSecrets: string[]
      documentedSecrets: string[]
    }
  | {
      status: 'error'
      provider: string
      reason: string
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
  staleAlert: {
    warranted: boolean
    sent: boolean
    skippedReason: string | null
    to: string | null
  }
  notes: string[]
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
  const created = Date.parse(input.newestCreatedAt)
  if (!Number.isFinite(created)) {
    return { ageMs: null, stale: chicagoWeekday, chicagoWeekday }
  }
  const ageMs = Math.max(0, now.getTime() - created)
  // Weekend: log freshness but do not page — PropStream/CSV drops are weekday ops.
  const stale = chicagoWeekday && ageMs >= thresholdMs
  return { ageMs, stale, chicagoWeekday }
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

  const row = (newest.data?.[0] ?? null) as { created_at?: string; updated_at?: string } | null
  const newestCreatedAt = typeof row?.created_at === 'string' ? row.created_at : null
  const newestUpdatedAt = typeof row?.updated_at === 'string' ? row.updated_at : null
  const evaluated = evaluateForeclosureStale({ newestCreatedAt, now })
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
 * Resolve an ingest payload without inventing PropStream API shapes.
 * Supported today:
 * - `csv_url` when FORECLOSURE_INGEST_CSV_URL is set (returns pilot CSV)
 * - explicit CSV body passed by the caller (manual / GH Action drop)
 * PropStream remains not_configured until operator supplies documented base URL + key.
 */
export async function resolveForeclosureIngestProvider(input?: {
  csvBody?: string | null
}): Promise<ForeclosureProviderStatus> {
  const documentedSecrets = [
    'FORECLOSURE_INGEST_PROVIDER',
    'FORECLOSURE_INGEST_CSV_URL',
    'PROPSTREAM_API_KEY',
    'PROPSTREAM_API_BASE_URL',
    'PROPSTREAM_ACCOUNT_ID',
    'FORECLOSURE_INGEST_ACTOR_EMAIL',
    'FORECLOSURE_STALE_ALERT_TO',
    'FORECLOSURE_STALE_ALERT_MIN_INTERVAL_HOURS',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'CRON_SECRET',
  ]

  if (typeof input?.csvBody === 'string' && input.csvBody.trim()) {
    return {
      status: 'ready',
      provider: 'csv_url',
      csv: input.csvBody,
      source: 'request_body',
    }
  }

  const provider = (process.env.FORECLOSURE_INGEST_PROVIDER || '').trim().toLowerCase() || 'unset'
  const csvUrl = (process.env.FORECLOSURE_INGEST_CSV_URL || '').trim()
  const propstreamKey = (process.env.PROPSTREAM_API_KEY || '').trim()
  const propstreamBase = (process.env.PROPSTREAM_API_BASE_URL || '').trim()
  const propstreamAccount = (process.env.PROPSTREAM_ACCOUNT_ID || '').trim()

  if (provider === 'csv_url' || (!provider || provider === 'unset') && csvUrl) {
    if (!csvUrl) {
      return {
        status: 'not_configured',
        provider: 'csv_url',
        reason: 'FORECLOSURE_INGEST_PROVIDER=csv_url but FORECLOSURE_INGEST_CSV_URL is empty.',
        missingSecrets: ['FORECLOSURE_INGEST_CSV_URL'],
        documentedSecrets,
      }
    }
    try {
      const response = await fetch(csvUrl, {
        headers: { Accept: 'text/csv,text/plain,*/*' },
        signal: AbortSignal.timeout(25_000),
        cache: 'no-store',
      })
      if (!response.ok) {
        return {
          status: 'error',
          provider: 'csv_url',
          reason: `CSV drop URL returned HTTP ${response.status}.`,
        }
      }
      const csv = await response.text()
      if (!csv.trim()) {
        return {
          status: 'error',
          provider: 'csv_url',
          reason: 'CSV drop URL returned an empty body.',
        }
      }
      return {
        status: 'ready',
        provider: 'csv_url',
        csv,
        source: csvUrl,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'csv_url_fetch_failed'
      return { status: 'error', provider: 'csv_url', reason: message.slice(0, 300) }
    }
  }

  if (provider === 'propstream' || propstreamKey || propstreamBase || propstreamAccount) {
    const missing: string[] = []
    if (!propstreamKey) missing.push('PROPSTREAM_API_KEY')
    if (!propstreamBase) missing.push('PROPSTREAM_API_BASE_URL')
    // Account id is optional depending on PropStream's real docs — still listed.
    return {
      status: 'not_configured',
      provider: 'propstream',
      reason:
        'PropStream pull is scaffolded only. This repo has no first-hand PropStream API docs or client. Set PROPSTREAM_API_BASE_URL from PropStream\'s own documentation (do not invent paths), then wire the client. Until then use FORECLOSURE_INGEST_PROVIDER=csv_url + FORECLOSURE_INGEST_CSV_URL or POST CSV to the cron.',
      missingSecrets: missing.length ? missing : ['PROPSTREAM_API_BASE_URL (documented endpoint required)'],
      documentedSecrets,
    }
  }

  return {
    status: 'not_configured',
    provider,
    reason:
      'No foreclosure feed is configured. Export PropStream (or county) CSVs to FORECLOSURE_INGEST_CSV_URL, or POST the pilot CSV to /api/cron/foreclosure-ingest. Do not invent PropStream endpoints.',
    missingSecrets: ['FORECLOSURE_INGEST_PROVIDER', 'FORECLOSURE_INGEST_CSV_URL'],
    documentedSecrets,
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

/** Module-local dedupe so a noisy cron does not spam Resend within one instance. */
let lastStaleAlertAtMs = 0

export function resetForeclosureStaleAlertDedupeForTests() {
  lastStaleAlertAtMs = 0
}

export async function sendForeclosureStaleAlert(input: {
  freshness: ForeclosureFreshness
  notes: string[]
  force?: boolean
}): Promise<{ sent: boolean; skippedReason: string | null; to: string | null }> {
  const to = (process.env.FORECLOSURE_STALE_ALERT_TO || DEFAULT_ALERT_TO).trim().toLowerCase()
  if (!input.freshness.stale && !input.force) {
    return { sent: false, skippedReason: 'not_stale', to }
  }
  if (!input.freshness.chicagoWeekday && !input.force) {
    return { sent: false, skippedReason: 'weekend', to }
  }

  const now = Date.now()
  if (!input.force && lastStaleAlertAtMs && now - lastStaleAlertAtMs < alertMinIntervalMs()) {
    return { sent: false, skippedReason: 'min_interval', to }
  }

  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.RESEND_FROM_EMAIL?.trim()
  if (!apiKey || !from) {
    console.warn('[foreclosure-daily-ingest] stale alert skipped: RESEND_API_KEY / RESEND_FROM_EMAIL missing', {
      newestCreatedAt: input.freshness.newestCreatedAt,
    })
    return { sent: false, skippedReason: 'resend_not_configured', to }
  }

  const ageHours = input.freshness.ageMs == null
    ? 'unknown (empty table)'
    : `${(input.freshness.ageMs / 3_600_000).toFixed(1)}h`
  const subject = `Foreclosure portal stale — last create ${ageHours}`
  const body = [
    'Saving KC CRM foreclosure daily ingest',
    '',
    `Chicago date: ${input.freshness.chicagoDate}`,
    `Prospect rows: ${input.freshness.prospectCount}`,
    `Newest created_at: ${input.freshness.newestCreatedAt ?? '(none)'}`,
    `Newest updated_at: ${input.freshness.newestUpdatedAt ?? '(none)'}`,
    `Age: ${ageHours}`,
    '',
    'Portal: https://crm.savingkc.com/prospecting/foreclosure',
    '',
    'Notes:',
    ...(input.notes.length ? input.notes.map((note) => `- ${note}`) : ['- (none)']),
    '',
    'This alert fails soft and never sends SMS. Fix by dropping pilot CSV to FORECLOSURE_INGEST_CSV_URL or POSTing CSV to /api/cron/foreclosure-ingest.',
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
      return { sent: false, skippedReason: 'resend_error', to }
    }
    lastStaleAlertAtMs = now
    return { sent: true, skippedReason: null, to }
  } catch (error) {
    console.error('[foreclosure-daily-ingest] stale alert failed soft', {
      message: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
    })
    return { sent: false, skippedReason: 'resend_exception', to }
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

  const provider = await resolveForeclosureIngestProvider({ csvBody: input?.csvBody })
  let importResult: ForeclosureDailyIngestResult['import'] = null
  let watermarksAdvanced: ForeclosureDailyIngestResult['watermarksAdvanced'] = []

  if (provider.status === 'ready') {
    if (activeControls.length === 0) {
      notes.push('All ingest controls are paused — CSV was not imported.')
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

  const staleAlert = input?.skipAlert
    ? { warranted: freshness.stale, sent: false, skippedReason: 'skip_alert_flag', to: null }
    : {
        warranted: freshness.stale,
        ...(await sendForeclosureStaleAlert({ freshness, notes })),
      }

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
    staleAlert: {
      warranted: staleAlert.warranted,
      sent: staleAlert.sent,
      skippedReason: staleAlert.skippedReason,
      to: staleAlert.to,
    },
    notes,
  }
}
