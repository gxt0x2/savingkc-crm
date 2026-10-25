import type { SupabaseClient } from '@supabase/supabase-js'

import {
  buildWebsiteConversionReport,
  chicagoRangeInstants,
  isConversionRange,
  lastCompleteAnalyticsDay,
  rangeWindow,
  type AnalyticsSyncRun,
  type ConversionLeadRow,
  type ConversionRange,
  type ConversionTrackingRow,
  type Ga4LandingRow,
  type GscQueryRow,
  type WebsiteConversionReport,
} from '@/lib/marketing/website-conversion'

const PAGE_SIZE = 1000
const MAX_ROWS = 250_000

type PostgrestError = { code?: string; message?: string } | null

export class WebsiteConversionReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebsiteConversionReadError'
  }
}

export function isMissingRelation(error: PostgrestError): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '')
}

async function selectAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError }>,
): Promise<T[] | null> {
  const rows: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) {
      if (isMissingRelation(error)) return null
      throw new WebsiteConversionReadError(error.message || 'Website conversion data could not be read.')
    }
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return rows
  }
  throw new WebsiteConversionReadError('Website conversion data exceeded the read limit.')
}

export async function loadWebsiteConversionReport(
  db: SupabaseClient,
  rangeInput: string | null,
  now = new Date(),
): Promise<WebsiteConversionReport> {
  const range: ConversionRange = isConversionRange(rangeInput) ? rangeInput : 'day'
  const anchorDate = lastCompleteAnalyticsDay(now)
  const window = rangeWindow(range, anchorDate)
  const { startIso, endIso } = chicagoRangeInstants(window.start, window.end)

  const [ga4Rows, gscRows, leads, events, syncRuns, ga4LatestResult, gscLatestResult] = await Promise.all([
    selectAll<Ga4LandingRow>((from, to) => db
      .from('ga4_landing_daily')
      .select('date, landing_page, session_source_medium, sessions, engaged_sessions, synced_at')
      .gte('date', window.start)
      .lte('date', window.end)
      .order('date', { ascending: true })
      .order('landing_page', { ascending: true })
      .order('session_source_medium', { ascending: true })
      .range(from, to)),
    selectAll<GscQueryRow>((from, to) => db
      .from('gsc_page_query_daily')
      .select('date, page, clicks, impressions, position, synced_at')
      .gte('date', window.start)
      .lte('date', window.end)
      .order('date', { ascending: true })
      .order('page', { ascending: true })
      .order('query', { ascending: true })
      .order('country', { ascending: true })
      .order('device', { ascending: true })
      .range(from, to)),
    selectAll<ConversionLeadRow>((from, to) => db
      .from('leads')
      .select('source, created_at')
      .in('source', ['website_form', 'google_ads_phone', 'google_ads_tax_phone'])
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .order('created_at', { ascending: true })
      .range(from, to)),
    selectAll<ConversionTrackingRow>((from, to) => db
      .from('ppc_tracking_events')
      .select('event_name, event_time, session_id, is_test')
      .eq('is_test', false)
      .gte('event_time', startIso)
      .lt('event_time', endIso)
      .order('event_time', { ascending: true })
      .range(from, to)),
    db
      .from('analytics_sync_runs')
      .select('source, mode, started_at, finished_at, since_date, until_date, status, rows_upserted, error')
      .order('started_at', { ascending: false })
      .limit(40)
      .then((result) => {
        if (result.error) {
          if (isMissingRelation(result.error)) return [] as AnalyticsSyncRun[]
          throw new WebsiteConversionReadError(result.error.message)
        }
        return (result.data ?? []) as AnalyticsSyncRun[]
      }),
    db.from('ga4_landing_daily').select('date, synced_at').order('date', { ascending: false }).limit(1).maybeSingle(),
    db.from('gsc_page_query_daily').select('date, synced_at').order('date', { ascending: false }).limit(1).maybeSingle(),
  ])

  if (ga4LatestResult.error && !isMissingRelation(ga4LatestResult.error)) {
    throw new WebsiteConversionReadError(ga4LatestResult.error.message)
  }
  if (gscLatestResult.error && !isMissingRelation(gscLatestResult.error)) {
    throw new WebsiteConversionReadError(gscLatestResult.error.message)
  }

  return buildWebsiteConversionReport({
    range,
    now,
    ga4Rows,
    gscRows,
    leads,
    events,
    syncRuns: syncRuns ?? [],
    ga4Latest: ga4LatestResult.data
      ? { date: ga4LatestResult.data.date ?? null, syncedAt: ga4LatestResult.data.synced_at ?? null }
      : undefined,
    gscLatest: gscLatestResult.data
      ? { date: gscLatestResult.data.date ?? null, syncedAt: gscLatestResult.data.synced_at ?? null }
      : undefined,
  })
}
