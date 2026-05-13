export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { fullRerank, revivePastDueParkedLeads } from '@/lib/hot-engine'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'

/**
 * POST /api/admin/rerank
 *
 * Force-runs the hot-opportunities full re-rank regardless of business hours.
 * The cron variant at /api/hot-opportunities/cron refuses outside 8am-7pm CST,
 * which breaks recovery flows that need to repopulate the cache after a bulk
 * station change.
 *
 * Auth: Bearer ADMIN_API_SECRET / CRON_SECRET (or signed-in admin)
 */
export async function POST(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  try {
    const revival = await revivePastDueParkedLeads()
    const result = await fullRerank()
    return NextResponse.json({
      ok: true,
      revivedParked: revival.revived,
      scored: result.scored,
      hotList: result.hotList,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[admin/rerank] failed:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
