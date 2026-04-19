/**
 * POST /api/leads/[id]/reprocess
 *
 * Runs a single lead through the full intelligence pipeline (same helpers
 * as the Mojo live path). Idempotent: safe to call repeatedly. Backfills
 * lead_activities from mojo_call_queue history, re-runs transcripts,
 * re-scores, re-enriches if needed, cascades manifest → leads row.
 *
 * Body (optional): {
 *   suppressNotifications?: boolean (default: true)
 *   refreshTranscripts?: boolean (default: true)
 *   forceReEnrich?: boolean (default: false)
 * }
 *
 * GET /api/leads/[id]/reprocess — returns the last reprocess activity row.
 */

import { NextRequest, NextResponse } from 'next/server'
import { reprocessLead, getLastReprocessResult } from '@/lib/lead-pipeline'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'lead id required' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))

  try {
    const result = await reprocessLead(id, {
      suppressNotifications: body.suppressNotifications ?? true,
      refreshTranscripts: body.refreshTranscripts ?? true,
      forceReEnrich: body.forceReEnrich ?? false,
    })
    return NextResponse.json(result)
  } catch (err: any) {
    console.error(`[reprocess-lead] Failed for ${id}:`, err)
    return NextResponse.json(
      { error: err?.message || String(err), leadId: id },
      { status: 500 },
    )
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'lead id required' }, { status: 400 })
  }

  const last = await getLastReprocessResult(id)
  if (!last) {
    return NextResponse.json({ leadId: id, lastReprocess: null })
  }
  return NextResponse.json({ leadId: id, lastReprocess: last })
}
