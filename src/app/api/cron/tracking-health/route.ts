import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { collectTrackingHealthSnapshot, evaluateTrackingHealth, summarizeFailures } from '@/lib/marketing/tracking-health'
import { sendTrackingHealthSmsAlert } from '@/lib/server/operational-sms-alerts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' }

/** Daily tracking health check. ?notify=0 runs the checks without alerting. */
async function handle(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const notify = new URL(req.url).searchParams.get('notify') !== '0'
  const db = supabaseAdmin()
  const snapshot = await collectTrackingHealthSnapshot(db)
  const checks = evaluateTrackingHealth(snapshot)
  const { critical, warnings, text } = summarizeFailures(checks)
  const runDate = snapshot.now.slice(0, 10)

  let notified = false
  let texted = false
  if (notify && (critical.length || warnings.length)) {
    const { error } = await db.from('notifications').insert({
      type: 'tracking_health',
      title: `Tracking health: ${critical.length} to fix, ${warnings.length} to watch`,
      body: text,
      url: '/marketing',
      metadata: { run_date: runDate, failing: [...critical, ...warnings].map((c) => c.key) },
    })
    if (error) console.error('[tracking-health] notification insert failed:', error.message)
    notified = !error
    if (critical.length) {
      const sms = await sendTrackingHealthSmsAlert({ runDate, failures: critical.map((c) => c.label) }).catch((err) => {
        console.error('[tracking-health] SMS alert failed:', err)
        return null
      })
      texted = Boolean(sms?.result?.success)
    }
  }

  return NextResponse.json(
    { ok: critical.length === 0, checks, notified, texted, snapshot },
    { headers: HEADERS },
  )
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
