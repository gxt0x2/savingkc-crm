/**
 * POST /api/admin/reprocess-all-leads
 *
 * Server-side orchestrator for the enrichment-first pass. Iterates leads
 * (paginated) and runs reprocessLead() — same primitive used by
 * /api/leads/{id}/reprocess. This endpoint exists so out-of-process
 * orchestrators don't need direct Supabase access; they just hit one URL.
 *
 * Auth: Bearer ADMIN_API_SECRET / CRON_SECRET, OR signed-in admin.
 *
 * Body (all fields optional):
 *   {
 *     "limit": 50,             // max leads to process this call. Default 50.
 *                              // Use small values; the endpoint is bounded to
 *                              // avoid serverless / Caddy timeouts.
 *     "offset": 0,             // pagination — use returned `nextOffset` to chain
 *     "leadIds": ["id1", ...], // specific leads (overrides offset/limit/staleOnly)
 *     "staleOnly": true,       // only leads with updated_at < 30d ago OR null station
 *     "dryRun": true,          // returns the lead list, doesn't reprocess
 *     "forceReEnrich": true,   // passes through to reprocessLead. Default true.
 *     "refreshTranscripts": true  // passes through. Default true.
 *   }
 *
 * Response:
 *   {
 *     "totalCandidates": 217,
 *     "processedThisCall": 50,
 *     "nextOffset": 50,       // null when done
 *     "results": [
 *       { "leadId": "...", "ok": true, "elapsedMs": 4128, "changed": [...],
 *         "skipped": [...], "errors": [...], "opportunityScore": 65 },
 *       ...
 *     ]
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { reprocessLead } from '@/lib/lead-pipeline'
import { supabase } from '@/lib/supabase-lazy'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'

interface ReprocessBody {
  limit?: number
  offset?: number
  leadIds?: string[]
  staleOnly?: boolean
  dryRun?: boolean
  forceReEnrich?: boolean
  refreshTranscripts?: boolean
}

const MAX_BATCH = 100   // never process more than this in a single call
const DEFAULT_BATCH = 50

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  let body: ReprocessBody = {}
  try {
    body = await req.json()
  } catch {
    // Empty body is fine — use defaults.
  }

  const limit = Math.min(body.limit ?? DEFAULT_BATCH, MAX_BATCH)
  const offset = body.offset ?? 0
  const staleOnly = body.staleOnly === true
  const dryRun = body.dryRun === true
  const forceReEnrich = body.forceReEnrich !== false  // default true
  const refreshTranscripts = body.refreshTranscripts !== false  // default true

  // ── 1. Build candidate list ────────────────────────────────────────────
  let candidates: { id: string; full_name: string | null; phone: string | null; station: string | null }[] = []
  let totalCandidates: number | null = null

  if (body.leadIds && Array.isArray(body.leadIds) && body.leadIds.length > 0) {
    // Explicit lead list — skip pagination.
    const { data } = await supabase
      .from('leads')
      .select('id, full_name, phone, station')
      .in('id', body.leadIds.slice(0, MAX_BATCH))
    candidates = data ?? []
    totalCandidates = candidates.length
  } else {
    let query = supabase
      .from('leads')
      .select('id, full_name, phone, station', { count: 'exact' })

    if (staleOnly) {
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
      query = query.or(`updated_at.lt.${cutoff},station.is.null`)
    }

    query = query
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1)

    const { data, count } = await query
    candidates = data ?? []
    totalCandidates = count
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      totalCandidates,
      processedThisCall: 0,
      candidates: candidates.map(c => ({ id: c.id, name: c.full_name, station: c.station })),
      nextOffset: candidates.length === limit ? offset + limit : null,
    })
  }

  // ── 2. Reprocess (serial — county scrapers + transcription are heavy) ──
  const results: Array<{
    leadId: string
    ok: boolean
    elapsedMs: number
    changed?: string[]
    skipped?: string[]
    errors?: string[]
    opportunityScore?: number | null
    manifestId?: string | null
    error?: string
  }> = []

  for (const lead of candidates) {
    const t0 = Date.now()
    try {
      const r = await reprocessLead(lead.id, {
        suppressNotifications: true,
        refreshTranscripts,
        forceReEnrich,
      })
      results.push({
        leadId: lead.id,
        ok: true,
        elapsedMs: Date.now() - t0,
        changed: r.changed,
        skipped: r.skipped,
        errors: r.errors,
        opportunityScore: r.opportunityScore,
        manifestId: r.manifestId,
      })
    } catch (err: any) {
      results.push({
        leadId: lead.id,
        ok: false,
        elapsedMs: Date.now() - t0,
        error: err?.message || String(err),
      })
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    totalCandidates,
    processedThisCall: results.length,
    nextOffset: candidates.length === limit ? offset + limit : null,
    results,
  })
}
