import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { mapMojoDisposition, mergeMojoCallEvidence, qualifyMojoCallRecord, type MojoCallRecord } from '@/lib/server/mojo-call-import'
import { supabaseAdmin } from '@/lib/supabase/admin'

export type { MojoCallRecord }

const MAX_CALLS_PER_REQUEST = 500

function hasActionableFollowUp(call: MojoCallRecord): boolean {
  const followUpAt = Date.parse(call.follow_up_date || '')
  return Number.isFinite(followUpAt)
    && followUpAt >= Date.now() - 5 * 60 * 1000
    && ['callback_scheduled', 'meaningful_conversation'].includes(mapMojoDisposition(call.disposition))
}

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
    let held = 0
    let enriched = 0
    let evidenceOnly = 0
    const receipts: Array<{ recordId: string | null; status: 'accepted' | 'duplicate' | 'rejected'; reason?: string }> = []
    const heldReasons: Record<string, number> = {}

    for (const raw of body.calls) {
      let call: MojoCallRecord
      let waitingForEvidence = false
      try {
        const qualification = qualifyMojoCallRecord(raw as MojoCallRecord)
        call = qualification.call
        waitingForEvidence = qualification.assessment.status === 'evidence_pending'
          && !hasActionableFollowUp(call)
        if (waitingForEvidence) {
          held++
          for (const reason of qualification.assessment.reasons) {
            heldReasons[reason] = (heldReasons[reason] || 0) + 1
          }
        }
      } catch {
        rejected++
        receipts.push({ recordId: typeof raw?.record_id === 'string' ? raw.record_id : null, status: 'rejected', reason: 'invalid_record' })
        continue
      }

      const { error } = await db.from('mojo_call_queue').insert({
        record_id: call.record_id,
        payload: call,
        status: waitingForEvidence ? 'waiting_evidence' : 'pending',
      })
      if (!error) {
        receipts.push({ recordId: call.record_id, status: 'accepted' })
        if (!waitingForEvidence) {
          queued++
          if (!call.promotion_eligible) evidenceOnly++
        }
      } else if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate')) {
        const { data: existing, error: readError } = await db
          .from('mojo_call_queue')
          .select('payload,status')
          .eq('record_id', call.record_id)
          .maybeSingle()
        if (readError || !existing?.payload) {
          rejected++
          receipts.push({ recordId: call.record_id, status: 'rejected', reason: 'queue_read_failed' })
          continue
        }
        let merged: ReturnType<typeof mergeMojoCallEvidence>
        try { merged = mergeMojoCallEvidence(existing.payload, call) }
        catch {
          rejected++
          receipts.push({ recordId: call.record_id, status: 'rejected', reason: 'evidence_conflict' })
          continue
        }
        if (!merged.improved) {
          skipped++
          receipts.push({ recordId: call.record_id, status: 'duplicate' })
          continue
        }
        if (existing.status === 'processing') {
          rejected++
          receipts.push({ recordId: call.record_id, status: 'rejected', reason: 'processing_retry' })
          continue
        }
        const mergedWaitingForEvidence = merged.call.qualification_status === 'evidence_pending'
          && !hasActionableFollowUp(merged.call)
        const resetStatus = ['completed', 'dead_letter', 'failed', 'waiting_evidence'].includes(existing.status)
        const { data: updated, error: updateError } = await db
          .from('mojo_call_queue')
          .update({
            payload: merged.call,
            ...(resetStatus && {
              status: mergedWaitingForEvidence ? 'waiting_evidence' : 'pending',
              attempts: 0,
              completed_at: null,
              processing_started_at: null,
              last_error: null,
            }),
          })
          .eq('record_id', call.record_id)
          .eq('status', existing.status)
          .eq('payload', JSON.stringify(existing.payload))
          .select('record_id')
        if (updateError || updated?.length !== 1) {
          rejected++
          receipts.push({ recordId: call.record_id, status: 'rejected', reason: 'queue_update_conflict' })
        } else {
          enriched++
          receipts.push({ recordId: call.record_id, status: 'accepted' })
        }
      } else {
        console.error('[mojo/sync] Queue insert failed:', error.message)
        rejected++
        receipts.push({ recordId: call.record_id, status: 'rejected', reason: 'queue_write_failed' })
      }
    }

    return NextResponse.json({ receipts, queued, evidenceOnly, enriched, held, heldReasons, skipped, rejected, total: body.calls.length })
  } catch (error) {
    console.error('[mojo/sync] Queue request failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
