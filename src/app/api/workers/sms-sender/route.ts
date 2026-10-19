/**
 * SMS Sender Worker
 * Processes pending SMS tasks (Ghost Protocol, follow-ups, etc.)
 *
 * POST /api/workers/sms-sender - Run worker (cron trigger)
 * GET /api/workers/sms-sender - Health/stats
 *
 * Cron: every 5 min — curl -X POST https://crm.savingkc.com/api/workers/sms-sender -H "Authorization: Bearer $CRON_SECRET"
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { QUEUED_SMS_CONTRACT } from '@/lib/queued-sms'

const CRON_SECRET = process.env.CRON_SECRET
const MAX_PER_RUN = 50

function isOfficeHours(): boolean {
  const now = new Date()
  const centralTime = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/Chicago' })
  )
  const hour = centralTime.getHours()
  const dayOfWeek = centralTime.getDay()
  // Mon-Sat, 9am-7pm CT
  return dayOfWeek >= 1 && dayOfWeek <= 6 && hour >= 9 && hour < 19
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

export async function POST(request: Request) {
  // Auth check
  const authHeader = request.headers.get('authorization')
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const force = searchParams.get('force') === 'true'

  if (!force && !isOfficeHours()) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: 'Outside office hours (9am-7pm CT, Mon-Sat)',
    })
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Only process forward-compatible scheduled SMS rows. Legacy pending rows
    // are intentionally ignored so old backlogs cannot wake up after fixes.
    const now = new Date().toISOString()
    const { data: tasks, error: queryError } = await supabase
      .from('lead_activities')
      .select('id, lead_id, description, metadata')
      .in('activity_type', ['sms'])
      .contains('metadata', { status: 'pending', queue_contract: QUEUED_SMS_CONTRACT })
      .lte('metadata->>due_date', now)
      .limit(MAX_PER_RUN)

    if (queryError) {
      console.error('SMS sender query error:', queryError)
      return NextResponse.json({ success: false, error: queryError.message }, { status: 500 })
    }

    const sent = 0
    let skipped = 0
    const failed = 0

    // Queued follow-ups, confirmations, and drips are not human 1:1 sends.
    // Mark them skipped so a later worker change cannot deliver the backlog.
    for (const task of tasks || []) {
      const meta = (task.metadata || {}) as Record<string, unknown>
      console.error('[sms-sender] refused queued SMS', {
        taskId: task.id,
        reason: 'automated_sms_disabled',
      })
      await supabase
        .from('lead_activities')
        .update({
          metadata: {
            ...meta,
            status: 'skipped',
            skip_reason: 'automated_sms_disabled',
            skipped_at: new Date().toISOString(),
          },
        })
        .eq('id', task.id)
      skipped++
    }

    // Update system_workers
    await supabase
      .from('system_workers')
      .upsert(
        {
          name: 'SMS Sender',
          last_run: new Date().toISOString(),
          last_success: new Date().toISOString(),
          status: 'healthy',
          metadata: { sent, skipped, failed, total: (tasks || []).length },
        },
        { onConflict: 'name' }
      )

    return NextResponse.json({
      success: true,
      processed: (tasks || []).length,
      sent,
      skipped,
      failed,
    })
  } catch (err: unknown) {
    const errorMessage = getErrorMessage(err)
    console.error('SMS sender worker error:', err)
    return NextResponse.json(
      { success: false, error: errorMessage || 'Worker failed' },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: worker } = await supabase
      .from('system_workers')
      .select('*')
      .eq('name', 'SMS Sender')
      .single()

    // Count pending SMS tasks
    const { count } = await supabase
      .from('lead_activities')
      .select('id', { count: 'exact', head: true })
      .in('activity_type', ['sms'])
      .contains('metadata', { status: 'pending', queue_contract: QUEUED_SMS_CONTRACT })

    return NextResponse.json({
      worker_status: worker?.status || 'unknown',
      last_run: worker?.last_run || null,
      last_success: worker?.last_success || null,
      pending_tasks: count || 0,
      queue_contract: QUEUED_SMS_CONTRACT,
      office_hours: isOfficeHours(),
      office_hours_info: '9am-7pm CT, Monday-Saturday',
      max_per_run: MAX_PER_RUN,
    })
  } catch {
    return NextResponse.json({ error: 'Status check failed' }, { status: 500 })
  }
}
