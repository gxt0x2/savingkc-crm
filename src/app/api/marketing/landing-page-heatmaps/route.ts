import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import { buildLandingPageHeatmapReport, type LandingHeatmapEventRow } from '@/lib/marketing/landing-page-heatmaps'
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
  const { data, error } = await db
    .from('ppc_tracking_events')
    .select('id,event_id,event_name,event_category,event_time,session_id,visitor_id,lead_id,page_path,page_location,campaign,form_step,payload')
    .eq('is_test', false)
    .gte('event_time', since.toISOString())
    .lte('event_time', until.toISOString())
    .order('event_time', { ascending: false })
    .limit(10000)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  return NextResponse.json(
    buildLandingPageHeatmapReport({
      rows: (data ?? []) as LandingHeatmapEventRow[],
      days,
      since: since.toISOString(),
      until: until.toISOString(),
      pageFilter: filter,
    }),
    { headers: NO_STORE_HEADERS },
  )
}
