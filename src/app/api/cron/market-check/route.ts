import { NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { syncMarketFlags } from '@/lib/market-check/run'
import { chicagoClock, marketCheckWindow } from '@/lib/market-check/schedule'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function missedExport(db: ReturnType<typeof supabaseAdmin>, day: string): Promise<boolean> {
  const { count, error } = await db.from('mls_export_runs')
    .select('id', { count: 'exact', head: true })
    .eq('chicago_day', day)
    .eq('status', 'loaded')
  if (error) throw new Error(error.message)
  if ((count ?? 0) > 0) return false
  const { error: alertError } = await db.from('mls_market_alerts').insert({
    alert_day: day,
    kind: 'missed_export',
    detail: 'No metro-wide Matrix export was loaded by 3:30am America/Chicago. No new off_market_ok rows were written. Expired and high-price tags from the last good export still apply.',
  })
  if (alertError && !/duplicate|unique/i.test(alertError.message || '')) throw new Error(alertError.message)
  return true
}

async function handle(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized
  const now = new Date()
  const window = marketCheckWindow(now)
  if (window !== 'deadline') {
    return NextResponse.json({ ok: true, skipped: true, window, load: 'admin POST or scripts/load-market-check-csv.mts' })
  }
  const db = supabaseAdmin()
  await syncMarketFlags(db)
  const alerted = await missedExport(db, chicagoClock(now).date)
  return NextResponse.json({ ok: true, window, alerted })
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
