import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import {
  buildLandingPageHeatmapReport,
  dealPageEventsToHeatmapRows,
  type DealPageHeatmapEventRow,
  type LandingHeatmapEventRow,
} from '@/lib/marketing/landing-page-heatmaps'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function pageFilter(value: string | null): string {
  if (value === '/ppc' || value === '/ppc-tax' || value === 'deals') return value
  return 'all'
}

export async function GET(req: NextRequest) {
  const email = await getCurrentUserEmail()
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }

  const url = new URL(req.url)
  const days = parsePositiveInt(url.searchParams.get('days'), 30, 1, 90)
  const filter = pageFilter(url.searchParams.get('page'))
  const until = new Date()
  const since = new Date(until)
  since.setUTCDate(until.getUTCDate() - days)

  const db = supabaseAdmin()
  const includePpcEvents = filter !== 'deals'
  const includeDealEvents = filter === 'all' || filter === 'deals'

  const [ppcEventsRes, dealEventsRes] = await Promise.all([
    includePpcEvents
      ? db
        .from('ppc_tracking_events')
        .select('id,event_id,event_name,event_category,event_time,session_id,visitor_id,lead_id,page_path,page_location,campaign,form_step,payload')
        .eq('is_test', false)
        .gte('event_time', since.toISOString())
        .lte('event_time', until.toISOString())
        .order('event_time', { ascending: false })
        .limit(10000)
      : Promise.resolve({ data: [], error: null }),
    includeDealEvents
      ? db
        .from('deal_page_events')
        .select('id,event_id,event_type,created_at,session_id,visitor_id,buyer_id,page_path,page_location,utm_campaign,metadata,section,element_text,element_tag,x_pct,y_pct,scroll_pct,share_id,ref_code')
        .eq('is_internal', false)
        .gte('created_at', since.toISOString())
        .lte('created_at', until.toISOString())
        .order('created_at', { ascending: false })
        .limit(10000)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (ppcEventsRes.error) {
    return NextResponse.json({ error: ppcEventsRes.error.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  if (dealEventsRes.error) {
    return NextResponse.json({ error: dealEventsRes.error.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const rows = [
    ...((ppcEventsRes.data ?? []) as LandingHeatmapEventRow[]),
    ...dealPageEventsToHeatmapRows((dealEventsRes.data ?? []) as DealPageHeatmapEventRow[]),
  ]

  return NextResponse.json(
    buildLandingPageHeatmapReport({
      rows,
      days,
      since: since.toISOString(),
      until: until.toISOString(),
      pageFilter: filter,
    }),
    { headers: NO_STORE_HEADERS },
  )
}
