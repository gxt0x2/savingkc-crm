export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface EventRow {
  event_type: string
  visitor_id: string | null
  referrer: string | null
  ref_code: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// GET /api/deals/:slug/stats — aggregated engagement stats for the deal page
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

  const [{ data: events }, { data: offers }] = await Promise.all([
    db.from('deal_page_events')
      .select('event_type, visitor_id, referrer, ref_code, metadata, created_at')
      .eq('deal_page_id', dealPage.id)
      .order('created_at', { ascending: false })
      .limit(5000),
    db.from('buyer_offers')
      .select('id, offer_amount, buyer_id, status, created_at')
      .eq('deal_page_id', dealPage.id)
      .order('created_at', { ascending: false }),
  ])

  const rows = (events || []) as EventRow[]

  // Aggregations
  const countsByType: Record<string, number> = {}
  const visitorsSet = new Set<string>()
  const referrersMap = new Map<string, number>()
  const hourlyViews: Record<string, number> = {}

  for (const e of rows) {
    countsByType[e.event_type] = (countsByType[e.event_type] || 0) + 1
    if (e.event_type === 'page_view' && e.visitor_id) {
      visitorsSet.add(e.visitor_id)
    }
    if (e.referrer) {
      try {
        const host = new URL(e.referrer).hostname
        referrersMap.set(host, (referrersMap.get(host) || 0) + 1)
      } catch { /* skip invalid */ }
    }
    if (e.event_type === 'page_view') {
      const day = e.created_at.slice(0, 10)
      hourlyViews[day] = (hourlyViews[day] || 0) + 1
    }
  }

  const topReferrers = Array.from(referrersMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([host, count]) => ({ host, count }))

  const viewsByDay = Object.entries(hourlyViews)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ day, count }))

  // Engagement funnel
  const views = countsByType.page_view || 0
  const offerModalOpens = countsByType.offer_modal_open || 0
  const offersSubmitted = (offers || []).length
  const funnelConversion = views > 0 ? Math.round((offersSubmitted / views) * 100 * 10) / 10 : 0

  return NextResponse.json({
    summary: {
      views,
      unique_visitors: visitorsSet.size,
      shares: countsByType.share_click || 0,
      share_visits: countsByType.share_visit || 0,
      photo_opens: countsByType.photo_open || 0,
      street_view_opens: countsByType.street_view_open || 0,
      map_view_opens: countsByType.map_view_open || 0,
      offer_modal_opens: offerModalOpens,
      offers_submitted: offersSubmitted,
      inquiry_modal_opens: countsByType.inquiry_modal_open || 0,
      inquiries_submitted: countsByType.inquiry_submit || 0,
      conversion_rate_pct: funnelConversion,
    },
    top_referrers: topReferrers,
    views_by_day: viewsByDay,
    offers: offers || [],
    recent_events: rows.slice(0, 50),
  })
}
