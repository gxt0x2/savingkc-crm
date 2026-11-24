import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  FIRST_FORECLOSURE_COUNTIES,
  FORECLOSURE_NOTICE_TYPES,
  chicagoDate,
  type ForeclosureNoticeType,
  type IngestControl,
  scrapeUpdatedSince,
} from '@/lib/prospecting/foreclosure'
import { fetchCountyPublicCsv } from '@/lib/server/foreclosure-county-public'
import {
  listForeclosureIngestControls,
  setForeclosureIngestControl,
} from '@/lib/server/foreclosure-ingest'
import { ForeclosureError, importForeclosureCsv } from '@/lib/server/foreclosure-prospects'
import {
  alertCounties,
  countyLabel,
  evaluateForeclosureCounties,
  foreclosureCountyProviderSignals,
  isChicagoWeekday,
  laterIso,
  loadForeclosureCountyActivity,
  sendForeclosureStaleAlert,
  type ForeclosureCountyProviderSignal,
  type ForeclosureStaleAlertResult,
} from '@/lib/server/foreclosure-stale-alert'
import { supabase } from '@/lib/supabase-lazy'

const TABLE = 'mortgage_foreclosure_prospects'
const STALE_MS = 24 * 60 * 60 * 1000

export {
  activeForeclosureCounties,
  evaluateForeclosureCounties,
  foreclosureCountyProviderSignals,
  isChicagoWeekday,
  loadForeclosureCountyActivity,
  resetForeclosureStaleAlertDedupeForTests,
  sendForeclosureStaleAlert,
} from '@/lib/server/foreclosure-stale-alert'
export type {
  ForeclosureCountyActivity,
  ForeclosureCountyProviderSignal,
  ForeclosureStaleAlertResult,
  ForeclosureStaleCounty,
} from '@/lib/server/foreclosure-stale-alert'

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
