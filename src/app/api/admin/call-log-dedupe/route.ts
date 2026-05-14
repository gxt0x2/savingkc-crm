export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'

/**
 * POST /api/admin/call-log-dedupe
 *
 * One-time backfill that retro-fits the Recent Call log to the new
 * one-row-per-call shape. The dialer historically wrote two rows per call —
 * status=initiated on start and status=completed on end. PR #159 hid the
 * initiated rows from the UI. This endpoint cleans them up in the DB.
 *
 * Strategy:
 *   - Find every outbound activity row with status=initiated.
 *   - For each, look for a matching status=completed row from the same agent
 *     to the same `to` number within 8 hours after.
 *   - If a match exists → delete the initiated row (completed has full info).
 *   - If no match → promote the initiated row to status=completed so it
 *     surfaces in Recent (orphaned start row, lost end event).
 *
 * Body:
 *   { "apply": false, "limit": 5000 }
 *
 * Auth: Bearer ADMIN_API_SECRET / CRON_SECRET
 */

interface ActivityRow {
  id: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  let body: { apply?: boolean; limit?: number } = {}
  try { body = await req.json() } catch { /* empty OK */ }

  const apply = body.apply === true
  const limit = Math.min(body.limit ?? 5000, 20000)
  const db = supabaseAdmin()

  // Pull all outbound call activity rows in chronological order. We sort the
  // join in JS rather than at SQL because the metadata->>status filter would
  // need an indexed expression to scale; the dataset is small enough.
  const { data: rows, error } = await db
    .from('lead_activities')
    .select('id, description, agent, metadata, created_at')
    .eq('activity_type', 'call')
    .eq('metadata->>direction', 'outbound')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const initiated: ActivityRow[] = []
  const completedByKey = new Map<string, ActivityRow[]>()

  function key(agent: string | null, to: string | null): string {
    return `${(agent || '').toLowerCase()}|${(to || '').replace(/\D/g, '')}`
  }

  for (const r of (rows ?? []) as ActivityRow[]) {
    const status = (r.metadata && typeof r.metadata === 'object')
      ? String((r.metadata as Record<string, unknown>).status ?? '')
      : ''
    if (status === 'initiated') {
      initiated.push(r)
    } else if (status === 'completed') {
      const to = r.metadata && typeof (r.metadata as Record<string, unknown>).to === 'string'
        ? String((r.metadata as Record<string, unknown>).to)
        : null
      const k = key(r.agent, to)
      if (!completedByKey.has(k)) completedByKey.set(k, [])
      completedByKey.get(k)!.push(r)
    }
  }

  const EIGHT_HOURS = 8 * 60 * 60 * 1000
  const toDelete: string[] = []
  const toPromote: string[] = []

  for (const init of initiated) {
    const to = init.metadata && typeof (init.metadata as Record<string, unknown>).to === 'string'
      ? String((init.metadata as Record<string, unknown>).to)
      : null
    const k = key(init.agent, to)
    const initTime = new Date(init.created_at).getTime()
    const candidates = completedByKey.get(k) || []
    const match = candidates.find((c) => {
      const t = new Date(c.created_at).getTime()
      return t >= initTime && t - initTime <= EIGHT_HOURS
    })
    if (match) {
      toDelete.push(init.id)
    } else {
      toPromote.push(init.id)
    }
  }

  let deleted = 0
  let promoted = 0
  if (apply) {
    if (toDelete.length > 0) {
      const { error: delErr, count } = await db
        .from('lead_activities')
        .delete({ count: 'exact' })
        .in('id', toDelete)
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
      deleted = count ?? toDelete.length
    }
    for (const id of toPromote) {
      const orig = initiated.find((r) => r.id === id)
      if (!orig) continue
      const md = (orig.metadata && typeof orig.metadata === 'object')
        ? { ...(orig.metadata as Record<string, unknown>) }
        : {}
      md.status = 'completed'
      md.duration = md.duration ?? 0
      md.outcome = md.outcome ?? 'unknown_orphan_initiated'
      const { error: updErr } = await db
        .from('lead_activities')
        .update({ metadata: md })
        .eq('id', id)
      if (updErr) {
        return NextResponse.json({ error: `promote failed for ${id}: ${updErr.message}` }, { status: 500 })
      }
      promoted++
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun: !apply,
    scanned: rows?.length ?? 0,
    initiatedCount: initiated.length,
    matched: toDelete.length,
    orphaned: toPromote.length,
    deleted,
    promoted,
  })
}
