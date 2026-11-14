import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse } from 'next/server'
import { isCurrentUserAdmin } from '@/lib/auth/admin'
import { runMatrixLoad, syncMarketFlags } from '@/lib/market-check/run'
import { chicagoClock, marketCheckWindow } from '@/lib/market-check/schedule'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const INBOX = join(process.cwd(), 'data', 'mls-inbox')

function cronCaller(request: Request): boolean {
  const agent = request.headers.get('user-agent') || ''
  return agent.toLowerCase().includes('vercel-cron')
}

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

function stagedCsv(): { csvText: string; fileName: string } | null {
  try {
    const name = readdirSync(INBOX).find((file) => file.toLowerCase().endsWith('.csv'))
    if (!name) return null
    return { fileName: name, csvText: readFileSync(join(INBOX, name), 'utf8') }
  } catch {
    return null
  }
}

async function handle(request: Request) {
  if (!cronCaller(request) && !(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const now = new Date()
  const window = marketCheckWindow(now)
  if (window === 'idle') {
    return NextResponse.json({ ok: true, skipped: true, window })
  }
  const db = supabaseAdmin()
  await syncMarketFlags(db)
  if (window === 'deadline') {
    const alerted = await missedExport(db, chicagoClock(now).date)
    return NextResponse.json({ ok: true, window, alerted })
  }
  const staged = stagedCsv()
  if (!staged) return NextResponse.json({ ok: true, window, loaded: false })
  const result = await runMatrixLoad(db, { ...staged, actor: 'market-check-cron', now })
  return NextResponse.json({ ok: true, window, loaded: true, ...result })
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
