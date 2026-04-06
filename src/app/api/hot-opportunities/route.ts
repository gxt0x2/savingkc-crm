import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getHotList, fullRerank, surgicalRescore } from '@/lib/hot-engine'

/**
 * GET  — Returns hot list (from cache). If first load of day or cache >2hrs old
 *        during business hours, triggers full re-rank first.
 *        ?audit=<leadId> — Returns audit trail for a specific lead.
 * POST { leadId } — Surgical rescore for one lead
 * POST { full: true } — Full re-rank
 */

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function isBusinessHours(): boolean {
  const now = new Date()
  const cstHour = (now.getUTCHours() - 6 + 24) % 24
  return cstHour >= 8 && cstHour < 19
}

export async function GET(request: NextRequest) {
  try {
    // Audit trail query
    const auditLeadId = request.nextUrl.searchParams.get('audit')
    if (auditLeadId) {
      const supabase = getSupabase()
      const { data } = await supabase
        .from('hot_score_audit_trail')
        .select('*')
        .eq('lead_id', auditLeadId)
        .order('created_at', { ascending: false })
        .limit(20)
      return NextResponse.json({ history: data || [] })
    }

    let { items, lastRankedAt } = await getHotList()

    // Auto re-rank if cache is stale during business hours
    if (isBusinessHours()) {
      const needsRerank = !lastRankedAt ||
        (Date.now() - new Date(lastRankedAt).getTime()) > 2 * 60 * 60 * 1000

      if (needsRerank) {
        await fullRerank()
        const fresh = await getHotList()
        items = fresh.items
        lastRankedAt = fresh.lastRankedAt
      }
    }

    // Diff-check safety net: compare cached timestamps against manifest lastUpdated
    const supabase = getSupabase()
    const leadIds = items.map(i => i.leadId)
    if (leadIds.length > 0) {
      const { data: manifestRows } = await supabase
        .from('manifests')
        .select('lead_id, updated_at')
        .in('lead_id', leadIds)

      const { data: cacheRows } = await supabase
        .from('hot_opportunities_cache')
        .select('lead_id, last_scored_at')
        .in('lead_id', leadIds)

      if (manifestRows && cacheRows) {
        const cacheMap = new Map(cacheRows.map((r: any) => [r.lead_id, r.last_scored_at]))
        const staleLeads: string[] = []

        for (const m of manifestRows) {
          const cachedAt = cacheMap.get(m.lead_id)
          if (cachedAt && m.updated_at && new Date(m.updated_at) > new Date(cachedAt)) {
            staleLeads.push(m.lead_id)
          }
        }

        // Rescore stale leads and refetch
        if (staleLeads.length > 0) {
          await Promise.all(staleLeads.map(id => surgicalRescore(id, 'diff_check_safety_net')))
          const fresh = await getHotList()
          items = fresh.items
          lastRankedAt = fresh.lastRankedAt
        }
      }
    }

    return NextResponse.json({ items, lastRankedAt })
  } catch (error) {
    console.error('[hot-opportunities] GET error:', error)
    return NextResponse.json({ items: [], lastRankedAt: null, error: 'Failed to load hot list' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (body.full) {
      const result = await fullRerank()
      return NextResponse.json({ ok: true, ...result })
    }

    if (body.leadId) {
      await surgicalRescore(body.leadId, 'manual_rescore')
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Invalid request — provide leadId or full: true' }, { status: 400 })
  } catch (error) {
    console.error('[hot-opportunities] POST error:', error)
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}
