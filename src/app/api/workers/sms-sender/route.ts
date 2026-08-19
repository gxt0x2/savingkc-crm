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
import { isOptedOut } from '@/lib/sms-opt-out'
import { getTemplate, resolveTemplate, incrementUsage } from '@/lib/sms-templates'
import { safeSendSMS } from '@/lib/safe-communications'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { QUEUED_SMS_CONTRACT } from '@/lib/queued-sms'

const CRON_SECRET = process.env.CRON_SECRET
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const MAX_PER_RUN = 50

interface LeadSmsContext {
  id: string
  full_name?: string | null
  phone?: string | null
  property_address?: string | null
}

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

    let sent = 0
    let skipped = 0
    let failed = 0

    for (const task of tasks || []) {
      const meta = (task.metadata || {}) as Record<string, unknown>

      // Load lead context for template fallback and phone fallback.
      let phone: string | null = typeof meta.to === 'string' ? meta.to : null
      let lead: LeadSmsContext | null = null
      if (task.lead_id) {
        const { data: leadData } = await supabase
          .from('leads')
          .select('id, full_name, phone, property_address')
          .eq('id', task.lead_id)
          .single()
        lead = leadData
        phone = phone || leadData?.phone || null
      }

      if (!phone) {
        await supabase
          .from('lead_activities')
          .update({ metadata: { ...meta, status: 'skipped', skip_reason: 'missing_phone' } })
          .eq('id', task.id)
        skipped++
        continue
      }

      // Check opt-out
      const isInternal = meta.is_internal === true || meta.internal_alert === true
      if (!isInternal && (await isOptedOut(phone))) {
        // Mark as skipped
        await supabase
          .from('lead_activities')
          .update({ metadata: { ...meta, status: 'skipped', skip_reason: 'opted_out' } })
          .eq('id', task.id)
        skipped++
        continue
      }

      // Prefer the rendered body stored by v2 producers. Template fallback is
      // only for explicit queued rows that did not persist a rendered message.
      let smsBody = String(meta.message || meta.body || '')
      const templateName = meta.template_name as string | undefined
      if (!smsBody && templateName) {
        const template = await getTemplate(templateName)
        if (template && lead) {
          smsBody = resolveTemplate(template.body, lead)
          await incrementUsage(templateName)
        }
      }

      if (!smsBody.trim()) {
        await supabase
          .from('lead_activities')
          .update({ metadata: { ...meta, status: 'skipped', skip_reason: 'empty_body' } })
          .eq('id', task.id)
        skipped++
        continue
      }

      const sendFrom = typeof meta.from === 'string' ? meta.from : TWILIO_PHONE

      // Send SMS
      try {
        const msg = await safeSendSMS({
          body: smsBody,
          from: sendFrom,
          to: phone,
        })

        if (!msg.success) {
          await supabase
            .from('lead_activities')
            .update({
              metadata: {
                ...meta,
                status: 'failed',
                failed_at: new Date().toISOString(),
                error: msg.error || 'safeSendSMS returned success=false',
              },
            })
            .eq('id', task.id)
          failed++
          continue
        }

        // Mark task as completed
        await supabase
          .from('lead_activities')
          .update({
            metadata: {
              ...meta,
              status: 'completed',
              completed_at: new Date().toISOString(),
              message_sid: msg.sid,
            },
          })
          .eq('id', task.id)

        // Log the outbound SMS
        await supabase.from('lead_activities').insert({
          lead_id: task.lead_id,
          activity_type: 'sms',
          description: smsBody,
          agent: 'System',
          metadata: {
            direction: 'outbound',
            from: sendFrom,
            to: phone,
            message_sid: msg.sid,
            trigger: 'sms_sender_worker',
            source_task_id: task.id,
            ...(isInternal ? { is_internal: true } : {}),
          },
        })

        sent++
      } catch (err: unknown) {
        const errorMessage = getErrorMessage(err)
        console.error(`SMS send failed for ${phone}:`, errorMessage)
        await supabase
          .from('lead_activities')
          .update({
            metadata: { ...meta, status: 'failed', error: errorMessage },
          })
          .eq('id', task.id)
        failed++
      }
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
