import { NextRequest, NextResponse } from 'next/server'
import { updateManifestAndCascade, ensureManifestExists } from '@/lib/manifest-sync'
import { randomUUID } from 'crypto'
import { supabase } from '@/lib/supabase-lazy'
import { buildQueuedSmsMetadata } from '@/lib/queued-sms'

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

    const appointmentId = randomUUID()

    // 1. Ensure manifest exists
    await ensureManifestExists(leadId)

    // 2. Update manifest with appointment object
    const updated = await updateManifestAndCascade(leadId, (manifest) => {
      manifest.pipeline.appointment = {
        appointmentId,
        type: type || 'phone_call',
        scheduledAt,
        createdAt: new Date().toISOString(),
        status: 'scheduled',
        confirmationCount: 0,
        lastSellerResponse: null,
        ghostRiskScore: 0,
        ghostProtocolActive: false,
        automationLog: [],
        assignedTo: assignedTo || 'casey',
        address: address || null,
        notes: notes || null,
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

    // 3. Log to lead_activities for calendar/timeline display
    const typeLabels: Record<string, string> = {
      in_person: 'In-Person Visit',
      phone_call: 'Phone Call',
      google_meet: 'Google Meet',
    }
    const typeLabel = typeLabels[type] || type
    const dateDisplay = new Date(scheduledAt).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago'
    })
    const timeDisplay = new Date(scheduledAt).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago'
    })

    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'appointment',
      description: `Appointment scheduled: ${typeLabel} on ${dateDisplay} at ${timeDisplay} with ${assignedTo}${notes ? `. Notes: ${notes}` : ''}`,
      agent: assignedTo || 'System',
      metadata: {
        appointment_id: appointmentId,
        type,
        scheduled_at: scheduledAt,
        due_date: scheduledAt,
        assigned_to: assignedTo,
        notes,
        status: 'scheduled',
      },
    })

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
