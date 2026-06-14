import { NextRequest, NextResponse } from 'next/server'
import { updateManifestAndCascade, ensureManifestExists } from '@/lib/manifest-sync'
import { randomUUID } from 'crypto'
import { supabase } from '@/lib/supabase-lazy'
import { buildQueuedSmsMetadata } from '@/lib/queued-sms'
import { normalizeDealStage } from '@/types/pipeline'
import { queuePpcQualifiedLeadConversion } from '@/lib/ppc/qualified-lead-conversion'
import { queuePpcAppointmentBookedConversion } from '@/lib/ppc/appointment-booked-conversion'
import { upsertAppointmentFromCall } from '@/lib/appointments'

// Stations that should auto-advance to appointment_set when an appointment
// is scheduled. We never demote a more-advanced station (offer_made,
// under_contract) and never resurrect a terminal one (dead, closed_*).
const ADVANCE_FROM_STATIONS = new Set(['new', 'contacted', 'qualified'])

/**
 * POST /api/leads/create-appointment
 * Server-side appointment creation — bypasses RLS on manifests table
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { leadId, type, scheduledAt, assignedTo, address, notes, sendReminder, phone, leadName } = body

    if (!leadId || !scheduledAt) {
      return NextResponse.json({ error: 'leadId and scheduledAt required' }, { status: 400 })
    }

    // 1. Ensure manifest exists
    await ensureManifestExists(leadId)

    const canonicalAppointment = await upsertAppointmentFromCall({
      leadId,
      scheduledAt,
      type: type || 'phone_call',
      address: address || null,
      notes: notes || null,
      source: 'manual',
      assignedTo: assignedTo || 'casey',
    })
    const appointmentId = canonicalAppointment?.id ?? randomUUID()
    const scheduledIso = canonicalAppointment?.scheduled_at ?? scheduledAt

    // 2. Update manifest with appointment object
    const updated = await updateManifestAndCascade(leadId, (manifest) => {
      manifest.pipeline.appointment = {
        appointmentId,
        type: type || 'phone_call',
        scheduledAt: scheduledIso,
        createdAt: new Date().toISOString(),
        status: 'scheduled',
        confirmationCount: 0,
        lastSellerResponse: null,
        ghostRiskScore: 0,
        ghostProtocolActive: false,
        reminderAutomationEnabled: true,
        reminderAutomationEnabledAt: new Date().toISOString(),
        reminderAutomationSource: 'appointment_modal',
        automationLog: [],
        assignedTo: assignedTo || 'casey',
        address: canonicalAppointment?.address ?? address ?? null,
        notes: canonicalAppointment?.notes ?? notes ?? null,
      }

      if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
      manifest.ariIntelligence.briefingStale = true

      if (!manifest.auditTrail) manifest.auditTrail = []
      manifest.auditTrail.push({
        timestamp: new Date().toISOString(),
        agent: 'appointment_modal',
        action: 'appointment_created',
        details: { type, scheduledAt, assignedTo, notes },
      })
    }, 'appointment_modal')

    // 2b. Auto-advance station to appointment_set when applicable. Without
    // this, leads stay at new/contacted/qualified after booking and miss the
    // appointment_set stage value in scoring.
    const { data: leadRow } = await supabase
      .from('leads')
      .select('station')
      .eq('id', leadId)
      .single()
    const currentStage = normalizeDealStage(leadRow?.station)
    const leadAppointmentPatch: Record<string, unknown> = {
      appointment_date: scheduledIso,
      appointment_notes: canonicalAppointment?.notes ?? notes ?? null,
      updated_at: new Date().toISOString(),
    }
    if (currentStage && ADVANCE_FROM_STATIONS.has(currentStage)) {
      leadAppointmentPatch.station = 'appointment_set'
    }
    await supabase
      .from('leads')
      .update(leadAppointmentPatch)
      .eq('id', leadId)

    if (currentStage && ADVANCE_FROM_STATIONS.has(currentStage)) {
      await updateManifestAndCascade(leadId, (manifest) => {
        manifest.currentStation = 'appointment_set'
        manifest.auditTrail = manifest.auditTrail ?? []
        manifest.auditTrail.push({
          timestamp: new Date().toISOString(),
          agent: 'appointment_modal',
          action: 'station_auto_advanced',
          details: { from: leadRow?.station, to: 'appointment_set', trigger: 'appointment_created' },
        })
      }, 'appointment_modal:auto_advance').catch(() => false)
      await queuePpcQualifiedLeadConversion({
        leadId,
        fromStation: leadRow?.station ?? null,
        toStation: 'appointment_set',
        changedBy: assignedTo || 'appointment_modal',
        reason: 'appointment_created',
      }).catch((error) => console.error('[create-appointment] PPC qualified conversion queue failed:', error))
    }

    // 3. Log to lead_activities for calendar/timeline display
    const typeLabels: Record<string, string> = {
      in_person: 'In-Person Visit',
      phone_call: 'Phone Call',
      google_meet: 'Google Meet',
    }
    const typeLabel = typeLabels[type] || type
    const dateDisplay = new Date(scheduledIso).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago'
    })
    const timeDisplay = new Date(scheduledIso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago'
    })

    const { data: appointmentActivity } = await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'appointment',
      description: `Appointment scheduled: ${typeLabel} on ${dateDisplay} at ${timeDisplay} with ${assignedTo}${notes ? `. Notes: ${notes}` : ''}`,
      agent: assignedTo || 'System',
      metadata: {
        appointment_id: appointmentId,
        type,
        scheduled_at: scheduledIso,
        due_date: scheduledIso,
        assigned_to: assignedTo,
        notes,
        status: 'scheduled',
      },
    }).select('id').maybeSingle()

    await queuePpcAppointmentBookedConversion({
      leadId,
      appointmentId,
      activityId: appointmentActivity?.id ?? null,
      scheduledAt: scheduledIso,
      appointmentType: type || 'phone_call',
      assignedTo: assignedTo || 'casey',
      source: 'appointment_modal',
    }).catch((error) => console.error('[create-appointment] PPC appointment conversion queue failed:', error))

    // 4. Create SMS reminder task if requested
    if (sendReminder && phone) {
      const reminderBody = `Hi ${leadName || 'there'}, your appointment with Saving KC is confirmed for ${dateDisplay} at ${timeDisplay}. We look forward to speaking with you!`

      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'sms',
        description: 'SMS appointment confirmation queued',
        agent: 'System',
        metadata: buildQueuedSmsMetadata({
          to: phone,
          from: process.env.TWILIO_PHONE_NUMBER || '+18163077835',
          body: reminderBody,
          source: 'appointment_modal',
          template: 'manual_appointment_confirmation',
        }),
      })
    }

    return NextResponse.json({
      success: true,
      appointmentId,
      manifestUpdated: updated,
    })
  } catch (err) {
    console.error('create-appointment error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
