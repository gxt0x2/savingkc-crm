/**
 * Appointment Reminder Worker
 * Runs every 5 minutes via cron. Checks upcoming appointments and queues
 * reminder SMS messages at the correct thresholds.
 *
 * GET /api/workers/appointment-reminder?secret=CRON_SECRET
 *   or Authorization: Bearer CRON_SECRET
 *
 * Architecture:
 *   READ from `manifests` table to find appointments
 *   WRITE via `updateManifestAndCascade()` to push automationLog entries
 *   Create pending SMS in `lead_activities` for the SMS Sender Worker to pick up
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateManifestAndCascade } from '@/lib/manifest-sync'
import { calculateGhostRisk } from '@/lib/ghost-risk-calculator'
import { shouldActivateGhostProtocol, runGhostProtocolAppointment } from '@/lib/ghost-protocol-appointment'
import { renderTemplate } from '@/lib/sms-templates'
import { buildQueuedSmsMetadata } from '@/lib/queued-sms'

const CRON_SECRET = process.env.CRON_SECRET
const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'

// ── Reminder thresholds ────────────────────────────────────────────────
// Each entry: [hoursBeforeAppointment, templateName, appliesToType]
// A negative value means AFTER booking (T+0 = at booking time, represented as Infinity)

interface ReminderThreshold {
  hoursBeforeAppt: number   // hours before appointment (0 = at appt time, Infinity = at booking)
  templateName: string
  appliesTo: 'phone' | 'inperson' | 'both'
  logAction: string
}

const REMINDER_THRESHOLDS: ReminderThreshold[] = [
  // T+0 — sent at booking time (always eligible if not yet sent)
  { hoursBeforeAppt: Infinity, templateName: 'appt_confirm_phone', appliesTo: 'phone', logAction: 'reminder_confirm_phone' },
  { hoursBeforeAppt: Infinity, templateName: 'appt_confirm_inperson', appliesTo: 'inperson', logAction: 'reminder_confirm_inperson' },
  // T-24h
  { hoursBeforeAppt: 24, templateName: 'appt_value_add_phone', appliesTo: 'phone', logAction: 'reminder_value_add_phone' },
  { hoursBeforeAppt: 24, templateName: 'appt_value_add_inperson', appliesTo: 'inperson', logAction: 'reminder_value_add_inperson' },
  // T-3h
  { hoursBeforeAppt: 3, templateName: 'appt_morning_confirm', appliesTo: 'both', logAction: 'reminder_morning_confirm' },
  // T-30min (phone only)
  { hoursBeforeAppt: 0.5, templateName: 'appt_lockin_30min', appliesTo: 'phone', logAction: 'reminder_lockin_30min' },
  // T-15min (in-person only)
  { hoursBeforeAppt: 0.25, templateName: 'appt_enroute_15min', appliesTo: 'inperson', logAction: 'reminder_enroute_15min' },
]

// Casey briefing thresholds: T-1h for phone, T-2h for in-person
const CASEY_BRIEFING = {
  phone: { hoursBeforeAppt: 1, logAction: 'casey_briefing_phone' },
  inperson: { hoursBeforeAppt: 2, logAction: 'casey_briefing_inperson' },
}

// ── Helpers ────────────────────────────────────────────────────────────

function getApptType(appointment: any): 'phone' | 'inperson' {
  const type = (appointment.type || appointment.appointmentType || '').toLowerCase()
  if (type.includes('person') || type.includes('walkthrough') || type.includes('visit')) {
    return 'inperson'
  }
  return 'phone'
}

function hoursUntil(dateStr: string): number {
  return (new Date(dateStr).getTime() - Date.now()) / 3600000
}

function formatDateTime(dateStr: string): { date: string; time: string } {
  const d = new Date(dateStr)
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'America/Chicago' }
  const date = d.toLocaleDateString('en-US', { ...opts, weekday: 'long', month: 'long', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { ...opts, hour: 'numeric', minute: '2-digit' })
  return { date, time }
}

function formatPhoneForSms(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits

  if (local.length !== 10) return phone
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
}

function hasLogEntry(automationLog: any[], action: string): boolean {
  return (automationLog || []).some((e: any) => e.action === action)
}

function thresholdCrossed(hoursLeft: number, thresholdHours: number): boolean {
  // Infinity means "at booking" — always eligible
  if (thresholdHours === Infinity) return true
  // The reminder should fire when we are AT or PAST the threshold
  return hoursLeft <= thresholdHours
}

// ── Main handler ───────────────────────────────────────────────────────

export async function GET(request: Request) {
  // Auth check: query param or Authorization header
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get('secret')
  const scopedLeadId = searchParams.get('leadId')?.trim() || null
  const authHeader = request.headers.get('authorization')
  const token = secret || authHeader?.replace('Bearer ', '')

  if (!CRON_SECRET || token !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    // 1. Query manifests with upcoming appointments
    let query = supabase
      .from('manifests')
      .select('id, lead_id, manifest')
      .in('appointment_status', ['scheduled', 'confirmed', 'reconfirmed'])
      .gt('next_appointment_at', new Date().toISOString())

    if (scopedLeadId) {
      query = query.eq('lead_id', scopedLeadId)
    }

    const { data: rows, error: queryError } = await query

    if (queryError) {
      console.error('[appointment-reminder] Query error:', queryError)
      return NextResponse.json({ success: false, error: queryError.message }, { status: 500 })
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        success: true,
        processed: 0,
        reminders_queued: 0,
        scoped_to_lead: scopedLeadId,
      })
    }

    let processed = 0
    let remindersQueued = 0
    let skipped = 0
    let ghostActivated = 0
    let ghostStepped = 0
    const errors: string[] = []

    for (const row of rows) {
      try {
        const manifest = row.manifest as any
        if (!manifest) continue

        const appointment = manifest?.pipeline?.appointment
        if (!appointment) continue

        // Forward-only safety gate: pre-cutover appointments are dead to this
        // worker unless a new creation path explicitly opted them in.
        if (appointment.reminderAutomationEnabled !== true) {
          skipped++
          continue
        }

        // If Ghost Protocol is active — run next step, skip normal reminders
        if (appointment.ghostProtocolActive === true) {
          try {
            await runGhostProtocolAppointment(row.lead_id)
            ghostStepped++
          } catch (gpErr: any) {
            console.error(`[appointment-reminder] Ghost protocol step failed for lead ${row.lead_id}:`, gpErr)
            errors.push(`ghost_step for lead ${row.lead_id}: ${gpErr.message}`)
          }
          skipped++
          continue
        }

        const apptDateStr = appointment.scheduledAt || appointment.dateTime || appointment.date
        if (!apptDateStr) continue

        const hoursLeft = hoursUntil(apptDateStr)
        // Appointment should be in the future (already filtered by query, but double-check)
        if (hoursLeft < 0) continue

        const apptType = getApptType(appointment)
        const automationLog: any[] = appointment.automationLog || []
        const ownerName = manifest?.owner?.firstName || 'there'
        const ownerPhone = manifest?.owner?.phone
        const address = appointment.address || manifest?.property?.address || ''
        const { date: formattedDate, time: formattedTime } = formatDateTime(apptDateStr)

        if (!ownerPhone) {
          skipped++
          continue
        }

        const templateVars: Record<string, string> = {
          firstName: ownerName,
          date: formattedDate,
          time: formattedTime,
          address,
          agentName: 'Casey',
          twilioNumber: formatPhoneForSms(TWILIO_PHONE),
        }

        processed++

        // 2. Check each reminder threshold
        for (const threshold of REMINDER_THRESHOLDS) {
          // Skip if this threshold doesn't apply to this appointment type
          if (threshold.appliesTo !== 'both' && threshold.appliesTo !== apptType) continue

          // Skip if already sent
          if (hasLogEntry(automationLog, threshold.logAction)) continue

          // Skip if threshold not yet crossed
          if (!thresholdCrossed(hoursLeft, threshold.hoursBeforeAppt)) continue

          // Render the SMS body
          let smsBody: string
          try {
            smsBody = renderTemplate(threshold.templateName, templateVars)
          } catch {
            // Template not found — skip this reminder
            console.warn(`[appointment-reminder] Template not found: ${threshold.templateName}`)
            continue
          }

          // Create pending SMS in lead_activities for SMS Sender Worker
          const { error: insertError } = await supabase
            .from('lead_activities')
            .insert({
              lead_id: row.lead_id,
              activity_type: 'sms',
              description: `Appointment reminder: ${threshold.templateName}`,
              metadata: buildQueuedSmsMetadata({
                to: ownerPhone,
                from: TWILIO_PHONE,
                body: smsBody,
                source: 'appointment-reminder-worker',
                template: threshold.templateName,
              }),
            })

          if (insertError) {
            console.error(`[appointment-reminder] Insert error for lead ${row.lead_id}:`, insertError)
            errors.push(`lead ${row.lead_id}: ${insertError.message}`)
            continue
          }

          // Update manifest: push to automationLog and recalculate ghost risk
          await updateManifestAndCascade(row.lead_id, (m: any) => {
            const appt = m.pipeline?.appointment
            if (!appt) return

            if (!appt.automationLog) appt.automationLog = []
            appt.automationLog.push({
              action: threshold.logAction,
              template: threshold.templateName,
              sentAt: new Date().toISOString(),
              hoursBeforeAppt: hoursLeft,
              sellerResponded: false,
            })

            // Recalculate ghost risk
            appt.ghostRiskScore = calculateGhostRisk(m)
          }, 'appointment-reminder-worker')

          remindersQueued++
        }

        // 3. Evening call task for in-person appointments at T-16h
        //    Targets 5-7pm the evening before. Only if confirmationCount < 2.
        if (
          apptType === 'inperson' &&
          (appointment.confirmationCount ?? 0) < 2 &&
          !hasLogEntry(automationLog, 'evening_call_task') &&
          thresholdCrossed(hoursLeft, 16)
        ) {
          const ghostScore = appointment.ghostRiskScore ?? calculateGhostRisk(manifest)
          const ghostColor = ghostScore >= 60 ? 'RED' : ghostScore >= 30 ? 'YELLOW' : 'GREEN'
          const confirmCount = appointment.confirmationCount ?? 0
          const dueDate = new Date(new Date(apptDateStr).getTime() - 16 * 3600000).toISOString()

          const taskDescription = [
            `Evening confirmation call for ${ownerName}`,
            address ? `Address: ${address}` : null,
            `Appointment: ${formattedDate} at ${formattedTime}`,
            `Confirmations so far: ${confirmCount}/2`,
            `Ghost Risk: ${ghostColor} (${ghostScore}/100)`,
            confirmCount === 0
              ? 'ALERT: Seller has NOT confirmed at all — high ghost risk'
              : 'Seller confirmed once but needs 2nd confirmation',
          ].filter(Boolean).join('\n')

          const { error: taskError } = await supabase
            .from('lead_activities')
            .insert({
              lead_id: row.lead_id,
              activity_type: 'task',
              description: taskDescription,
              metadata: {
                task_type: 'callback',
                due_date: dueDate,
                assigned_to: 'Casey',
                priority: 'high',
                status: 'pending',
                source: 'appointment-reminder-worker',
                ghost_risk_color: ghostColor,
                ghost_risk_score: ghostScore,
                confirmation_count: confirmCount,
                appointment_date: apptDateStr,
              },
            })

          if (taskError) {
            console.error(`[appointment-reminder] Evening call task insert error for lead ${row.lead_id}:`, taskError)
            errors.push(`evening_call_task for lead ${row.lead_id}: ${taskError.message}`)
          } else {
            await updateManifestAndCascade(row.lead_id, (m: any) => {
              const appt = m.pipeline?.appointment
              if (!appt) return
              if (!appt.automationLog) appt.automationLog = []
              appt.automationLog.push({
                action: 'evening_call_task',
                createdAt: new Date().toISOString(),
                hoursBeforeAppt: hoursLeft,
                ghostRiskColor: ghostColor,
                confirmationCount: confirmCount,
              })
            }, 'appointment-reminder-worker')

            remindersQueued++
          }
        }

        // 4. Casey briefing check
        const briefingConfig = CASEY_BRIEFING[apptType]
        if (
          !hasLogEntry(automationLog, briefingConfig.logAction) &&
          thresholdCrossed(hoursLeft, briefingConfig.hoursBeforeAppt)
        ) {
          // Build briefing message
          const briefingLines = [
            `APPOINTMENT BRIEFING — ${ownerName}`,
            `Type: ${apptType === 'phone' ? 'Phone Call' : 'In-Person'}`,
            `Time: ${formattedDate} at ${formattedTime}`,
          ]
          if (address) briefingLines.push(`Address: ${address}`)
          briefingLines.push(`Phone: ${ownerPhone}`)

          // Add ghost risk info
          const ghostScore = appointment.ghostRiskScore || 0
          if (ghostScore > 0) {
            briefingLines.push(`Ghost Risk: ${ghostScore}/100`)
          }

          // Add any seller responses from automation log
          const sellerReplies = automationLog.filter((e: any) => e.sellerResponded)
          if (sellerReplies.length > 0) {
            briefingLines.push(`Seller has replied to ${sellerReplies.length} reminder(s)`)
          } else if (automationLog.length > 0) {
            briefingLines.push(`NOTE: Seller has NOT replied to any reminders yet`)
          }

          const briefingMessage = briefingLines.join('\n')

          // Queue Casey briefing SMS
          const { error: caseyError } = await supabase
            .from('lead_activities')
            .insert({
              lead_id: row.lead_id,
              activity_type: 'sms',
              description: `Casey briefing for ${ownerName} appointment`,
              metadata: buildQueuedSmsMetadata({
                to: CASEY_PHONE,
                from: TWILIO_PHONE,
                body: briefingMessage,
                source: 'appointment-reminder-worker',
                template: 'casey_briefing',
                extra: { is_internal: true },
              }),
            })

          if (caseyError) {
            console.error(`[appointment-reminder] Casey briefing insert error:`, caseyError)
            errors.push(`casey briefing for lead ${row.lead_id}: ${caseyError.message}`)
          } else {
            // Log to manifest
            await updateManifestAndCascade(row.lead_id, (m: any) => {
              const appt = m.pipeline?.appointment
              if (!appt) return

              if (!appt.automationLog) appt.automationLog = []
              appt.automationLog.push({
                action: briefingConfig.logAction,
                sentAt: new Date().toISOString(),
                hoursBeforeAppt: hoursLeft,
              })
            }, 'appointment-reminder-worker')

            remindersQueued++
          }
        }

        // 5. Ghost Protocol activation check
        //    After all reminders processed, check if ghost risk crossed threshold
        const currentGhostRisk = appointment.ghostRiskScore ?? calculateGhostRisk(manifest)
        if (shouldActivateGhostProtocol(manifest)) {
          console.log(`[appointment-reminder] Activating Ghost Protocol for lead ${row.lead_id} (risk=${currentGhostRisk})`)

          await updateManifestAndCascade(row.lead_id, (m: any) => {
            const appt = m.pipeline?.appointment
            if (!appt) return
            appt.ghostProtocolActive = true
            appt.ghostRiskScore = currentGhostRisk

            if (!m.auditTrail) m.auditTrail = []
            m.auditTrail.push({
              timestamp: new Date().toISOString(),
              agent: 'appointment-reminder-worker',
              action: 'ghost_protocol_activated',
              details: { ghostRiskScore: currentGhostRisk },
            })

            if (!m.ariIntelligence) m.ariIntelligence = {}
            m.ariIntelligence.briefingStale = true
          }, 'appointment-reminder-worker')

          // Run first ghost protocol step immediately
          await runGhostProtocolAppointment(row.lead_id)
          ghostActivated++
        }
      } catch (rowError: any) {
        console.error(`[appointment-reminder] Error processing lead ${row.lead_id}:`, rowError)
        errors.push(`lead ${row.lead_id}: ${rowError.message}`)
      }
    }

    return NextResponse.json({
      success: true,
      processed,
      reminders_queued: remindersQueued,
      skipped,
      ghost_activated: ghostActivated,
      ghost_stepped: ghostStepped,
      scoped_to_lead: scopedLeadId,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error: any) {
    console.error('[appointment-reminder] Fatal error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
