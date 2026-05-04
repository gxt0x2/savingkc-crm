import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'

/**
 * GET /api/cron/sweep-briefings
 *
 * Hourly sweep that regenerates any manifest whose briefing is stale.
 * Keeps Ari Briefings fresh even when an agent hasn't opened the lead
 * page since the transcript landed — closes the "no one loaded the page
 * so nothing regenerated" gap.
 *
 * Rate-limited via BATCH_SIZE to keep Groq usage predictable.
 */
const BATCH_SIZE = 10

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const { data: rows, error } = await supabase
    .from('manifests')
    .select('id, lead_id, manifest, updated_at')
    .order('updated_at', { ascending: true })
    .limit(200)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const stale = (rows || []).filter((r) => {
    const m = r.manifest as { ariIntelligence?: { briefingStale?: boolean } } | null
    return m?.ariIntelligence?.briefingStale === true
  })

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'
  const results: Array<{ manifestId: string; leadId: string; status: 'ok' | 'fail'; detail?: string }> = []
  const toProcess = stale.slice(0, BATCH_SIZE)

  for (const row of toProcess) {
    try {
      const res = await fetch(`${baseUrl}/api/ari/generate-briefing?manifestId=${row.id}`, {
        headers: { 'x-regen-reason': 'cron_sweep' },
      })
      if (res.ok) {
        results.push({ manifestId: row.id, leadId: row.lead_id, status: 'ok' })
      } else {
        const body = await res.text().catch(() => '')
        results.push({ manifestId: row.id, leadId: row.lead_id, status: 'fail', detail: `${res.status}: ${body.slice(0, 120)}` })
      }
    } catch (err) {
      results.push({ manifestId: row.id, leadId: row.lead_id, status: 'fail', detail: (err as Error).message })
    }
  }

  return NextResponse.json({
    scanned: rows?.length || 0,
    stale: stale.length,
    processed: toProcess.length,
    remaining: Math.max(0, stale.length - toProcess.length),
    results,
  })
}
