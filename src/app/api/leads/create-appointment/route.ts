import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { queuePpcAppointmentBookedConversion } from '@/lib/ppc/appointment-booked-conversion'
import { upsertAppointmentFromCall } from '@/lib/appointments'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { oauthReviewForeignLeadResponse } from '@/lib/auth/oauth-review-sandbox-session'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { buildAppointmentCommand } from '@/lib/server/appointment-command'
import { googleCalendarSyncWarning, syncOwnedAppointmentToGoogleCalendar } from '@/lib/google-calendar'

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
    const { appointmentId: existingAppointmentId, leadId, type, scheduledAt, assignedTo, notes, sendReminder } = parsed.command
    const hiddenLead = await oauthReviewForeignLeadResponse(leadId, req)
    if (hiddenLead) return hiddenLead

    const { data: leadRow, error: leadError } = await supabase
      .from('leads')
      .select('phone, full_name, property_address')
      .eq('id', leadId)
      .maybeSingle()
    if (leadError) return NextResponse.json({ error: 'Contact could not be loaded' }, { status: 500 })
    if (!leadRow) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    const address = type === 'in_person' ? leadRow.property_address ?? null : null

    const canonicalAppointment = await upsertAppointmentFromCall({
      leadId,
      scheduledAt,
      appointmentId: existingAppointmentId,
      type,
      address,
      notes,
      source: 'manual',
      assignedTo,
      sequenceEnabled: sendReminder,
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

    // Calendar writeback uses the signed-in user's Google tokens. assignedTo
    // stays the operations owner and does not select the mailbox.
    const googleCalendar = await syncOwnedAppointmentToGoogleCalendar({
      actorEmail: actor.email,
      assignedTo,
      appointment: {
        id: appointmentId,
        scheduled_at: scheduledIso,
        type: canonicalAppointment.type || type,
        notes: canonicalAppointment.notes ?? notes,
        address: canonicalAppointment.address ?? address,
        google_event_id: canonicalAppointment.google_event_id ?? null,
      },
      leadName: leadRow.full_name,
    }).catch((error) => {
      console.warn('[create-appointment] Google Calendar sync failed:', error)
      return { status: 'skipped' as const, reason: 'calendar_sync_failed' }
    })
    const calendarWarning = googleCalendarSyncWarning(googleCalendar)
    if (googleCalendar.status === 'skipped' && calendarWarning) {
      console.warn(`[create-appointment] Google Calendar sync failed for ${appointmentId}: ${googleCalendar.reason}`)
      warnings.push(calendarWarning)
    } else if (googleCalendar.status === 'skipped') {
      console.info(`[create-appointment] Google Calendar sync skipped for ${appointmentId}: ${googleCalendar.reason}`)
    }

    // The appointment trigger atomically enrolls the durable Ghost Protocol sequence.

    return NextResponse.json({
      success: true,
      appointmentId,
      lifecycleAdvanced: lifecycle.advanced,
      googleCalendar,
      ...(warnings.length > 0 ? { warning: `Appointment saved. ${warnings.join(' ')} Do not create it again.` } : {}),
    })
  } catch (err) {
    console.error('create-appointment error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
