import { NextRequest, NextResponse } from 'next/server'
import { processQueuedCall, type MojoCallRecord } from '@/app/api/mojo/sync/route'
import { supabase } from '@/lib/supabase-lazy'

const BATCH_SIZE = 5
const MAX_ATTEMPTS = 3
const STALE_PROCESSING_MINUTES = 5

/**
 * GET /api/cron/process-mojo-queue
 *
 * Called every minute by Vercel cron (vercel.json).
 * 1. Resets stale "processing" items older than 5 minutes back to "pending"
 * 2. Claims up to 5 pending items atomically
 * 3. Processes each via processQueuedCall()
 * 4. On success: marks completed + stores lead_id/manifest_id/score
 * 5. On failure: resets to "pending" or promotes to "dead_letter" after 3 attempts
 */
export async function GET(req: NextRequest) {
  // Optional: cron secret check
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const startedAt = Date.now()

  // Step 1: Reset stale "processing" items (crashed or timed-out workers)
  const staleThreshold = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000).toISOString()
  const { data: staleItems } = await supabase
    .from('mojo_call_queue')
    .update({ status: 'pending', processing_started_at: null })
    .eq('status', 'processing')
    .lt('processing_started_at', staleThreshold)
    .select('id')

  const resetCount = staleItems?.length ?? 0
  if (resetCount > 0) {
    console.log(`[queue-worker] Reset ${resetCount} stale processing items`)
  }

  // Step 2: Claim up to BATCH_SIZE pending items.
  // We update first, then select — prevents double-claiming by concurrent invocations.
  // Supabase doesn't support UPDATE ... RETURNING with ORDER BY + LIMIT atomically,
  // so we use a two-step approach: fetch IDs then update.
  const { data: pendingItems } = await supabase
    .from('mojo_call_queue')
    .select('id, record_id, payload, attempts')
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (!pendingItems || pendingItems.length === 0) {
    return NextResponse.json({ processed: 0, elapsed_ms: Date.now() - startedAt })
  }

  // Claim each item individually (increment attempts, mark processing)
  const processingAt = new Date().toISOString()
  for (const item of pendingItems) {
    await supabase
      .from('mojo_call_queue')
      .update({
        status: 'processing',
        processing_started_at: processingAt,
        attempts: item.attempts + 1,
      })
      .eq('id', item.id)
      .eq('status', 'pending') // guard against race condition
  }

  // Step 3: Process each claimed item
  let processed = 0
  let failed = 0

  for (const item of pendingItems) {
    const call = item.payload as MojoCallRecord
    console.log(`[queue-worker] Processing ${item.record_id} (attempt ${item.attempts + 1})`)

    try {
      const result = await processQueuedCall(call, item.id)

      // Success
      await supabase
        .from('mojo_call_queue')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          lead_id: result.leadId,
          manifest_id: result.manifestId,
          opportunity_score: result.opportunityScore,
          last_error: null,
        })
        .eq('id', item.id)

      console.log(`[queue-worker] ✓ Completed ${item.record_id} — lead=${result.leadId} score=${result.opportunityScore}`)
      processed++
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      const newAttempts = item.attempts + 1
      const isDead = newAttempts >= MAX_ATTEMPTS
      const newStatus = isDead ? 'dead_letter' : 'pending'

      await supabase
        .from('mojo_call_queue')
        .update({
          status: newStatus,
          last_error: errorMsg,
          processing_started_at: null,
        })
        .eq('id', item.id)

      console.error(`[queue-worker] ✗ Failed ${item.record_id} (attempt ${newAttempts}/${MAX_ATTEMPTS}): ${errorMsg}`)
      if (isDead) {
        console.error(`[queue-worker] Dead letter: ${item.record_id}`)
      }
      failed++
    }
  }

  const elapsed = Date.now() - startedAt
  console.log(`[queue-worker] Done — processed=${processed} failed=${failed} elapsed=${elapsed}ms`)

  return NextResponse.json({
    processed,
    failed,
    total_claimed: pendingItems.length,
    stale_reset: resetCount ?? 0,
    elapsed_ms: elapsed,
  })
}
