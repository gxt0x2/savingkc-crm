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

const CRON_SECRET = process.env.CRON_SECRET
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
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
    const twilio = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )

    // Query pending SMS tasks that are due
    const now = new Date().toISOString()
    const { data: tasks, error: queryError } = await supabase
      .from('lead_activities')
      .select('id, lead_id, description, metadata')
      .in('activity_type', ['sms'])
      .contains('metadata', { status: 'pending' })
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
      const meta = task.metadata || {}

      // Get lead phone
      let phone: string | null = null
      let lead: any = null
      if (task.lead_id) {
        const { data: leadData } = await supabase
          .from('leads')
          .select('id, full_name, phone, property_address')
          .eq('id', task.lead_id)
          .single()
        lead = leadData
        phone = leadData?.phone
      }

      if (!phone) {
        skipped++
        continue
      }

      // Check opt-out
      if (await isOptedOut(phone)) {
        // Mark as skipped
        await supabase
          .from('lead_activities')
          .update({ metadata: { ...meta, status: 'skipped', skip_reason: 'opted_out' } })
          .eq('id', task.id)
        skipped++
        continue
      }

      // Resolve template if specified
      let smsBody = task.description || ''
      const templateName = meta.template_name as string | undefined
      if (templateName) {
        const template = await getTemplate(templateName)
        if (template && lead) {
          smsBody = resolveTemplate(template.body, lead)
          await incrementUsage(templateName)
        }
      }

      if (!smsBody.trim()) {
        skipped++
        continue
      }

      // Send SMS
      try {
        const msg = await twilio.messages.create({
          body: smsBody,
          from: TWILIO_PHONE,
          to: phone,
        })

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
            from: TWILIO_PHONE,
            to: phone,
            message_sid: msg.sid,
            trigger: 'sms_sender_worker',
            source_task_id: task.id,
          },
        })

        sent++
      } catch (err: any) {
        console.error(`SMS send failed for ${phone}:`, err.message)
        await supabase
          .from('lead_activities')
          .update({
            metadata: { ...meta, status: 'failed', error: err.message },
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
  } catch (err: any) {
    console.error('SMS sender worker error:', err)
    return NextResponse.json(
      { success: false, error: err.message || 'Worker failed' },
      { status: 500 }
    )
  }
}

export async function GET() {
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
      .contains('metadata', { status: 'pending' })

    return NextResponse.json({
      worker_status: worker?.status || 'unknown',
      last_run: worker?.last_run || null,
      last_success: worker?.last_success || null,
      pending_tasks: count || 0,
      office_hours: isOfficeHours(),
      office_hours_info: '9am-7pm CT, Monday-Saturday',
      max_per_run: MAX_PER_RUN,
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Status check failed' }, { status: 500 })
  }
}
