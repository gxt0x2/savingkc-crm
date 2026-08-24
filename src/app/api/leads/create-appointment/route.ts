import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { buildQueuedSmsMetadata } from '@/lib/queued-sms'
import { queuePpcAppointmentBookedConversion } from '@/lib/ppc/appointment-booked-conversion'
import { upsertAppointmentFromCall } from '@/lib/appointments'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { buildAppointmentCommand } from '@/lib/server/appointment-command'

/**
 * POST /api/leads/create-appointment
 * Server-side appointment creation against canonical appointment records.
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
      .select('phone, full_name, property_address')
      .eq('id', leadId)
      .maybeSingle()
    if (leadError) return NextResponse.json({ error: 'Contact could not be loaded' }, { status: 500 })
    if (!leadRow) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    const address = type === 'in_person' ? leadRow.property_address ?? null : null
    const phone = typeof leadRow.phone === 'string' ? leadRow.phone : null
    const leadName = typeof leadRow.full_name === 'string' ? leadRow.full_name : null

    const canonicalAppointment = await upsertAppointmentFromCall({
      leadId,
      scheduledAt,
      type,
      address,
      notes,
      source: 'manual',
      assignedTo,
    })
    if (!canonicalAppointment) {
      return NextResponse.json({ error: 'Appointment could not be saved' }, { status: 500 })
    }
    const appointmentId = canonicalAppointment.id
    const scheduledIso = canonicalAppointment.scheduled_at

    const { error: snapshotError } = await supabase
      .from('leads')
      .update({
        appointment_date: scheduledIso,
        appointment_notes: canonicalAppointment.notes ?? notes ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leadId)
    if (snapshotError) {
      return NextResponse.json({
        error: 'The appointment was saved, but the contact snapshot could not be refreshed. Do not create it again.',
        appointmentSaved: true,
        appointmentId,
      }, { status: 500 })
    }

    // Log to lead_activities for calendar/timeline display.
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

    const { data: appointmentActivity, error: activityError } = await supabase.from('lead_activities').insert({
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

    const warnings: string[] = []
    if (activityError) warnings.push('The appointment timeline entry is pending.')
    const lifecycle = await checkAutoAdvance(leadId, 'appointment_set').catch((error) => {
      console.error('[create-appointment] lifecycle advance failed:', error)
      warnings.push('The lifecycle stage refresh is pending.')
      return { advanced: false }
    })

    await queuePpcAppointmentBookedConversion({
      leadId,
      appointmentId,
      activityId: appointmentActivity?.id ?? null,
      scheduledAt: scheduledIso,
      appointmentType: type,
      assignedTo,
      source: 'appointment_modal',
    }).catch((error) => console.error('[create-appointment] PPC appointment conversion queue failed:', error))

    // Create SMS reminder task if requested.
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
      lifecycleAdvanced: lifecycle.advanced,
      ...(warnings.length > 0 ? { warning: `Appointment saved. ${warnings.join(' ')} Do not create it again.` } : {}),
    })
  } catch (err) {
    console.error('create-appointment error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
