import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Daily tracking health: catches silent tracking failures (like the Google Ads
 * login that expired for a month) before they cost a month of data.
 */

export type TrackingHealthSnapshot = {
  now: string
  realPageViews24h: number
  lastAdsSyncSuccessAt: string | null
  analyticsLastOkAt: Record<string, string | null>
  stalePendingConversions: number
  newDeadLetterConversions: number
  websiteLeadsMissingJourney: number
  websiteLeads14d: number
}

export type TrackingHealthCheck = {
  key: string
  label: string
  ok: boolean
  severity: 'critical' | 'warning'
  detail: string
}

export const ANALYTICS_SOURCES = ['ga4', 'ga4_events', 'gsc'] as const
const HOUR = 3_600_000

function hoursSince(iso: string | null, now: string): number | null {
  if (!iso) return null
  return (Date.parse(now) - Date.parse(iso)) / HOUR
}

function ago(hours: number | null): string {
  if (hours === null) return 'never'
  if (hours < 48) return `${Math.round(hours)} hours ago`
  return `${Math.round(hours / 24)} days ago`
}

export function evaluateTrackingHealth(s: TrackingHealthSnapshot): TrackingHealthCheck[] {
  const adsHours = hoursSince(s.lastAdsSyncSuccessAt, s.now)
  const checks: TrackingHealthCheck[] = [
    {
      key: 'page_views',
      label: 'Website visits are being recorded',
      ok: s.realPageViews24h > 0,
      severity: 'critical',
      detail: `${s.realPageViews24h} real page views in the last 24 hours`,
    },
    {
      key: 'google_ads_sync',
      label: 'Google Ads data is syncing',
      ok: adsHours !== null && adsHours <= 2,
      severity: 'critical',
      detail: `last successful sync ${ago(adsHours)}`,
    },
  ]
  for (const source of ANALYTICS_SOURCES) {
    const h = hoursSince(s.analyticsLastOkAt[source] ?? null, s.now)
    checks.push({
      key: `analytics_${source}`,
      label: `${source === 'gsc' ? 'Search Console' : source === 'ga4' ? 'GA4 landing pages' : 'GA4 events'} sync`,
      ok: h !== null && h <= 36,
      severity: 'critical',
      detail: `last good sync ${ago(h)}`,
    })
  }
  checks.push(
    {
      key: 'conversion_queue',
      label: 'Ad conversions are leaving the queue',
      ok: s.stalePendingConversions === 0 && s.newDeadLetterConversions === 0,
      severity: 'critical',
      detail: `${s.stalePendingConversions} waiting over 24 hours, ${s.newDeadLetterConversions} newly failed`,
    },
    {
      key: 'journey_linking',
      label: 'Website leads are linked to their visits',
      ok: s.websiteLeadsMissingJourney === 0,
      severity: 'critical',
      detail: `${s.websiteLeadsMissingJourney} website leads from the last day have no linked visits`,
    },
    {
      key: 'website_leads',
      label: 'Website forms are producing leads',
      ok: s.websiteLeads14d > 0,
      severity: 'warning',
      detail: `${s.websiteLeads14d} website form leads in 14 days`,
    },
  )
  return checks
}

export function summarizeFailures(checks: TrackingHealthCheck[]): { critical: TrackingHealthCheck[]; warnings: TrackingHealthCheck[]; text: string } {
  const failed = checks.filter((c) => !c.ok)
  const critical = failed.filter((c) => c.severity === 'critical')
  const warnings = failed.filter((c) => c.severity === 'warning')
  const text = failed.map((c) => `${c.severity === 'critical' ? 'FIX' : 'WATCH'}: ${c.label} (${c.detail})`).join('\n')
  return { critical, warnings, text }
}

export async function collectTrackingHealthSnapshot(db: SupabaseClient, now = new Date()): Promise<TrackingHealthSnapshot> {
  const iso = (ms: number) => new Date(now.getTime() - ms).toISOString()
  const day = iso(24 * HOUR)

  const [pageViews, adsRun, pending, dead, webLeads14, recentWebLeads, ...analytics] = await Promise.all([
    db.from('ppc_tracking_events').select('id', { count: 'exact', head: true })
      .eq('event_name', 'page_view').not('is_test', 'is', true).gte('event_time', day),
    db.from('google_ads_reporting_sync_runs').select('started_at').eq('status', 'success').eq('dry_run', false)
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('ppc_conversion_outbox').select('id', { count: 'exact', head: true })
      .eq('status', 'pending').lt('created_at', day),
    db.from('ppc_conversion_outbox').select('id', { count: 'exact', head: true })
      .eq('status', 'dead_letter').gte('updated_at', day),
    db.from('leads').select('id', { count: 'exact', head: true })
      .eq('source', 'website_form').gte('created_at', iso(14 * 24 * HOUR)),
    db.from('leads').select('id').eq('source', 'website_form')
      .gte('created_at', iso(48 * HOUR)).lt('created_at', iso(HOUR)).limit(50),
    ...ANALYTICS_SOURCES.map((source) => db.from('analytics_sync_runs').select('started_at')
      .eq('source', source).eq('status', 'ok').order('started_at', { ascending: false }).limit(1).maybeSingle()),
  ])

  const leadIds = ((recentWebLeads.data ?? []) as Array<{ id: string }>).map((row) => row.id)
  let missing = 0
  if (leadIds.length) {
    const { data } = await db.from('ppc_tracking_events').select('lead_id').in('lead_id', leadIds).limit(5000)
    const linked = new Set(((data ?? []) as Array<{ lead_id: string }>).map((row) => row.lead_id))
    missing = leadIds.filter((id) => !linked.has(id)).length
  }

  const analyticsLastOkAt: Record<string, string | null> = {}
  ANALYTICS_SOURCES.forEach((source, i) => {
    analyticsLastOkAt[source] = ((analytics.at(i)?.data ?? null) as { started_at?: string } | null)?.started_at ?? null
  })

  return {
    now: now.toISOString(),
    realPageViews24h: pageViews.count ?? 0,
    lastAdsSyncSuccessAt: ((adsRun.data ?? null) as { started_at?: string } | null)?.started_at ?? null,
    analyticsLastOkAt,
    stalePendingConversions: pending.count ?? 0,
    newDeadLetterConversions: dead.count ?? 0,
    websiteLeadsMissingJourney: missing,
    websiteLeads14d: webLeads14.count ?? 0,
  }
}
