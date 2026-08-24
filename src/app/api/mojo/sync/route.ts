import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { normalizeMojoCallRecord, type MojoCallRecord } from '@/lib/server/mojo-call-import'
import { supabaseAdmin } from '@/lib/supabase/admin'

export type { MojoCallRecord }

const MAX_CALLS_PER_REQUEST = 500

/**
 * Accept provider call facts into the durable queue and return immediately.
 * Lifecycle, appointment, and work-item effects run in the canonical worker;
 * this endpoint never analyzes, scores, enriches, alerts, or sends messages.
 */
export async function POST(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  try {
    const body = await req.json() as { calls?: unknown }
    if (!Array.isArray(body.calls) || body.calls.length === 0) {
      return NextResponse.json({ error: 'calls array required' }, { status: 400 })
    }
    if (body.calls.length > MAX_CALLS_PER_REQUEST) {
      return NextResponse.json({ error: `calls array exceeds ${MAX_CALLS_PER_REQUEST}` }, { status: 400 })
    }

    const db = supabaseAdmin()
    let queued = 0
    let skipped = 0
    let rejected = 0

    for (const raw of body.calls) {
      let call: MojoCallRecord
      try {
        call = normalizeMojoCallRecord(raw)
      } catch {
        rejected++
        continue
      }

      const { error } = await db.from('mojo_call_queue').insert({
        record_id: call.record_id,
        payload: call,
        status: 'pending',
      })
      if (!error) {
        queued++
      } else if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate')) {
        skipped++
      } else {
        console.error('[mojo/sync] Queue insert failed:', error.message)
        rejected++
      }
    }

    return NextResponse.json({ queued, skipped, rejected, total: body.calls.length })
  } catch (error) {
    console.error('[mojo/sync] Queue request failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
