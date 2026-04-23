export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface EventRow {
  event_type: string
  visitor_id: string | null
  session_id: string | null
  referrer: string | null
  ref_code: string | null
  metadata: Record<string, unknown>
  x_pct: number | null
  y_pct: number | null
  scroll_pct: number | null
  section: string | null
  element_tag: string | null
  element_text: string | null
  created_at: string
}

interface SessionRow {
  session_id: string
  visitor_id: string | null
  referrer: string | null
  ref_code: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  country: string | null
  region: string | null
  city: string | null
  device_type: string | null
  browser: string | null
  os: string | null
  started_at: string
  ended_at: string | null
  total_duration_ms: number | null
  active_duration_ms: number | null
  max_scroll_pct: number | null
  sections_viewed: string[] | null
  interactions: number | null
  is_bounced: boolean | null
  converted: boolean | null
  conversion_type: string | null
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function percentile(nums: number[], p: number): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx]
}

// GET /api/deals/:slug/stats — full analytics breakdown
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const db = supabaseAdmin()

  const { data: dealPage } = await db
    .from('deal_pages')
    .select('id, created_at')
    .eq('slug', slug)
    .single()
  if (!dealPage) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  const [eventsRes, sessionsRes, offersRes] = await Promise.all([
    db.from('deal_page_events')
      .select('event_type, visitor_id, session_id, referrer, ref_code, metadata, x_pct, y_pct, scroll_pct, section, element_tag, element_text, created_at')
      .eq('deal_page_id', dealPage.id)
      .order('created_at', { ascending: false })
      .limit(10000),
    db.from('deal_page_sessions')
      .select('*')
      .eq('deal_page_id', dealPage.id)
      .order('started_at', { ascending: false })
      .limit(1000),
    db.from('buyer_offers')
      .select('id, offer_amount, buyer_id, status, created_at')
      .eq('deal_page_id', dealPage.id)
      .order('created_at', { ascending: false }),
  ])

  const events = (eventsRes.data || []) as EventRow[]
  const sessions = (sessionsRes.data || []) as SessionRow[]
  const offers = offersRes.data || []

  // Event counts
  const countsByType: Record<string, number> = {}
  const visitorsSet = new Set<string>()
  for (const e of events) {
    countsByType[e.event_type] = (countsByType[e.event_type] || 0) + 1
    if (e.event_type === 'page_view' && e.visitor_id) visitorsSet.add(e.visitor_id)
  }

  // Session metrics
  const durations = sessions.map(s => s.total_duration_ms || 0).filter(n => n > 0)
  const activeDurations = sessions.map(s => s.active_duration_ms || 0).filter(n => n > 0)
  const scrollDepths = sessions.map(s => s.max_scroll_pct || 0)

  const bounced = sessions.filter(s => s.is_bounced).length
  const converted = sessions.filter(s => s.converted).length
  const totalSessions = sessions.length
  const bounceRate = totalSessions > 0 ? Math.round((bounced / totalSessions) * 100) : 0
  const conversionRate = totalSessions > 0 ? Math.round((converted / totalSessions) * 100 * 10) / 10 : 0

  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0
  const medianDuration = Math.round(median(durations))
  const p75Duration = Math.round(percentile(durations, 0.75))
  const avgActiveDuration = activeDurations.length ? Math.round(activeDurations.reduce((a, b) => a + b, 0) / activeDurations.length) : 0
  const totalTimeOnSite = durations.reduce((a, b) => a + b, 0)

  const avgScroll = scrollDepths.length ? Math.round(scrollDepths.reduce((a, b) => a + b, 0) / scrollDepths.length) : 0

  // Scroll depth histogram (0-25, 25-50, 50-75, 75-100)
  const scrollBuckets = [0, 0, 0, 0]
  for (const d of scrollDepths) {
    const i = Math.min(3, Math.floor(d / 25))
    scrollBuckets[i]++
  }

  // Device breakdown
  const devices: Record<string, number> = {}
  const browsers: Record<string, number> = {}
  const oses: Record<string, number> = {}
  for (const s of sessions) {
    if (s.device_type) devices[s.device_type] = (devices[s.device_type] || 0) + 1
    if (s.browser) browsers[s.browser] = (browsers[s.browser] || 0) + 1
    if (s.os) oses[s.os] = (oses[s.os] || 0) + 1
  }

  // Geo breakdown
  const countries: Record<string, number> = {}
  const cities: Record<string, number> = {}
  for (const s of sessions) {
    if (s.country) countries[s.country] = (countries[s.country] || 0) + 1
    if (s.city) cities[`${s.city}, ${s.region || ''}`] = (cities[`${s.city}, ${s.region || ''}`] || 0) + 1
  }

  // Referrer breakdown
  const referrers: Record<string, number> = {}
  const utmSources: Record<string, number> = {}
  for (const s of sessions) {
    if (s.referrer) {
      try {
        const host = new URL(s.referrer).hostname
        referrers[host] = (referrers[host] || 0) + 1
      } catch { /* skip */ }
    }
    if (s.utm_source) utmSources[s.utm_source] = (utmSources[s.utm_source] || 0) + 1
  }

  // Heat map — cluster clicks into a grid (20x20 bins of viewport)
  const heatMap: { x: number; y: number; count: number }[] = []
  const heatBins = new Map<string, number>()
  for (const e of events) {
    if (e.event_type !== 'click' || e.x_pct == null || e.y_pct == null) continue
    const bx = Math.floor(e.x_pct / 5) * 5
    const by = Math.floor(e.y_pct / 5) * 5
    const key = `${bx},${by}`
    heatBins.set(key, (heatBins.get(key) || 0) + 1)
  }
  for (const [key, count] of heatBins) {
    const [x, y] = key.split(',').map(Number)
    heatMap.push({ x, y, count })
  }

  // Section engagement — how many sessions viewed each section
  const sectionCounts: Record<string, number> = {}
  for (const s of sessions) {
    for (const sec of s.sections_viewed || []) {
      sectionCounts[sec] = (sectionCounts[sec] || 0) + 1
    }
  }

  // Views by day (for chart)
  const viewsByDay: Record<string, number> = {}
  for (const s of sessions) {
    const day = s.started_at.slice(0, 10)
    viewsByDay[day] = (viewsByDay[day] || 0) + 1
  }
  const viewsByDaySorted = Object.entries(viewsByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ day, count }))

  // Attention score per session (weighted composite)
  const attentionScored = sessions.map(s => {
    const timeScore = Math.min(100, ((s.active_duration_ms || 0) / 60000) * 20) // 5 min = 100
    const scrollScore = s.max_scroll_pct || 0
    const interactScore = Math.min(100, (s.interactions || 0) * 5)
    const sectionScore = Math.min(100, (s.sections_viewed?.length || 0) * 20)
    const conversionBonus = s.converted ? 50 : 0
    const score = Math.min(100, Math.round(
      timeScore * 0.3 + scrollScore * 0.2 + interactScore * 0.2 + sectionScore * 0.2 + conversionBonus * 0.1
    ))
    return { ...s, attention_score: score }
  }).sort((a, b) => b.attention_score - a.attention_score)

  // Funnel (events + sessions)
  const funnel = {
    visitors: visitorsSet.size,
    sessions: totalSessions,
    engaged_sessions: sessions.filter(s => !s.is_bounced).length,
    photos_opened: countsByType.photo_open || 0,
    street_view_opened: countsByType.street_view_open || 0,
    map_view_opened: countsByType.map_view_open || 0,
    offer_modal_opened: countsByType.offer_modal_open || 0,
    offers_submitted: offers.length,
  }

  return NextResponse.json({
    summary: {
      views: countsByType.page_view || 0,
      unique_visitors: visitorsSet.size,
      sessions: totalSessions,
      bounce_rate: bounceRate,
      conversion_rate_pct: conversionRate,
      shares: countsByType.share_click || 0,
      share_visits: countsByType.share_visit || 0,
      photo_opens: countsByType.photo_open || 0,
      street_view_opens: countsByType.street_view_open || 0,
      map_view_opens: countsByType.map_view_open || 0,
      offer_modal_opens: countsByType.offer_modal_open || 0,
      offers_submitted: offers.length,
      inquiry_modal_opens: countsByType.inquiry_modal_open || 0,
      inquiries_submitted: countsByType.inquiry_submit || 0,
      avg_time_on_page_ms: avgDuration,
      median_time_on_page_ms: medianDuration,
      p75_time_on_page_ms: p75Duration,
      avg_active_time_ms: avgActiveDuration,
      total_time_on_site_ms: totalTimeOnSite,
      avg_scroll_pct: avgScroll,
    },
    scroll_distribution: [
      { range: '0-25%', count: scrollBuckets[0] },
      { range: '25-50%', count: scrollBuckets[1] },
      { range: '50-75%', count: scrollBuckets[2] },
      { range: '75-100%', count: scrollBuckets[3] },
    ],
    devices: Object.entries(devices).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    browsers: Object.entries(browsers).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    oses: Object.entries(oses).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    countries: Object.entries(countries).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    cities: Object.entries(cities).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    top_referrers: Object.entries(referrers).map(([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    utm_sources: Object.entries(utmSources).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    heat_map: heatMap,
    section_engagement: Object.entries(sectionCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    views_by_day: viewsByDaySorted,
    funnel,
    offers,
    top_sessions: attentionScored.slice(0, 20),
    recent_events: events.slice(0, 50),
  })
}
