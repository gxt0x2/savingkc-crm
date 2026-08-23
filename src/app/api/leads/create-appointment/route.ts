import { NextRequest, NextResponse } from 'next/server'
import { updateManifestAndCascade, ensureManifestExists } from '@/lib/manifest-sync'
import { randomUUID } from 'crypto'
import { supabase } from '@/lib/supabase-lazy'
import { buildQueuedSmsMetadata } from '@/lib/queued-sms'
import { normalizeDealStage } from '@/types/pipeline'
import { queuePpcQualifiedLeadConversion } from '@/lib/ppc/qualified-lead-conversion'
import { queuePpcAppointmentBookedConversion } from '@/lib/ppc/appointment-booked-conversion'
import { upsertAppointmentFromCall } from '@/lib/appointments'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { buildAppointmentCommand } from '@/lib/server/appointment-command'

// Stations that should auto-advance to appointment_set when an appointment
// is scheduled. We never demote a more-advanced station (offer_made,
// under_contract) and never resurrect a terminal one (dead, closed_*).
const ADVANCE_FROM_STATIONS = new Set(['new', 'contacted', 'qualified'])

/**
 * POST /api/leads/create-appointment
 * Server-side appointment creation — bypasses RLS on manifests table
 */
export async function POST(req: NextRequest) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const parsed = buildAppointmentCommand(await req.json(), actor.name)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    const { leadId, type, scheduledAt, assignedTo, notes, sendReminder } = parsed.command

    const { data: leadRow, error: leadError } = await supabase
      .from('leads')
      .select('station, phone, full_name, property_address')
      .eq('id', leadId)
      .maybeSingle()
    if (leadError) return NextResponse.json({ error: 'Contact could not be loaded' }, { status: 500 })
    if (!leadRow) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    const address = type === 'in_person' ? leadRow.property_address ?? null : null
    const phone = typeof leadRow.phone === 'string' ? leadRow.phone : null
    const leadName = typeof leadRow.full_name === 'string' ? leadRow.full_name : null

    // 1. Ensure manifest exists
    await ensureManifestExists(leadId)

    const canonicalAppointment = await upsertAppointmentFromCall({
      leadId,
      scheduledAt,
      type,
      address,
      notes,
      source: 'manual',
      assignedTo,
    })
    const appointmentId = canonicalAppointment?.id ?? randomUUID()
    const scheduledIso = canonicalAppointment?.scheduled_at ?? scheduledAt

    // 2. Update manifest with appointment object
    const updated = await updateManifestAndCascade(leadId, (manifest) => {
      manifest.pipeline.appointment = {
        appointmentId,
        type,
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
        assignedTo,
        address: canonicalAppointment?.address ?? address,
        notes: canonicalAppointment?.notes ?? notes,
      }

      if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
      manifest.ariIntelligence.briefingStale = true

      if (!manifest.auditTrail) manifest.auditTrail = []
      manifest.auditTrail.push({
        timestamp: new Date().toISOString(),
        agent: actor.name,
        action: 'appointment_created',
        details: { type, scheduledAt: scheduledIso, assignedTo, notes },
      })
    }, 'appointment_modal')

    // 2b. Auto-advance station to appointment_set when applicable. Without
    // this, leads stay at new/contacted/qualified after booking and miss the
    // appointment_set stage value in scoring.
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
          agent: actor.name,
          action: 'station_auto_advanced',
          details: { from: leadRow?.station, to: 'appointment_set', trigger: 'appointment_created' },
        })
      }, 'appointment_modal:auto_advance').catch(() => false)
      await queuePpcQualifiedLeadConversion({
        leadId,
        fromStation: leadRow?.station ?? null,
        toStation: 'appointment_set',
        changedBy: actor.name,
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
      agent: actor.name,
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
      appointmentType: type,
      assignedTo,
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
