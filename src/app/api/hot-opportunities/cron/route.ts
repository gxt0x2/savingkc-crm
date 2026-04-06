import { NextResponse } from 'next/server'
import { fullRerank } from '@/lib/hot-engine'
import { createClient } from '@supabase/supabase-js'

/**
 * Cron route for hot opportunities re-ranking.
 * Called every 2hrs during 8am-7pm CST by external cron.
 * Also runs audit trail cleanup (delete > 90 days).
 */

function isBusinessHours(): boolean {
  const now = new Date()
  const cstHour = (now.getUTCHours() - 6 + 24) % 24
  return cstHour >= 8 && cstHour < 19
}

export async function GET() {
  // No re-rank outside business hours
  if (!isBusinessHours()) {
    return NextResponse.json({ skipped: true, reason: 'outside_business_hours' })
  }

  try {
    // Full re-rank
    const result = await fullRerank()

    // Audit trail cleanup (>90 days)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const { data: deleted } = await supabase
      .from('hot_score_audit_trail')
      .delete()
      .lt('created_at', cutoff)
      .select('id')
    const count = deleted?.length || 0

    return NextResponse.json({
      ok: true,
      scored: result.scored,
      hotList: result.hotList,
      auditCleaned: count || 0,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[hot-opportunities/cron] Error:', error)
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 })
  }
}
