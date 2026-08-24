/** Record a human-reviewed outcome on the canonical appointment row. */

import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { supabase } from '@/lib/supabase-lazy'

const VALID_OUTCOMES = ['completed', 'no_show', 'cancelled', 'rescheduled'] as const
type Outcome = (typeof VALID_OUTCOMES)[number]

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function POST(req: NextRequest) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as Record<string, unknown>
    const leadId = body.leadId
    const requestedAppointmentId = body.appointmentId
    const outcome = body.outcome
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 4000) : ''

    if (!isUuid(leadId) || !VALID_OUTCOMES.includes(outcome as Outcome)) {
      return NextResponse.json({ error: 'A valid contact and outcome are required' }, { status: 400 })
    }
    if (requestedAppointmentId != null && !isUuid(requestedAppointmentId)) {
      return NextResponse.json({ error: 'Invalid appointment identifier' }, { status: 400 })
    }

    let appointmentQuery = supabase
      .from('appointments')
      .select('id, notes, scheduled_at, status')
      .eq('lead_id', leadId)
    if (isUuid(requestedAppointmentId)) {
      appointmentQuery = appointmentQuery.eq('id', requestedAppointmentId)
    } else {
      appointmentQuery = appointmentQuery
        .in('status', ['scheduled', 'confirmed', 'rescheduled'])
        .order('scheduled_at', { ascending: false })
        .limit(1)
    }

    const { data: appointment, error: loadError } = await appointmentQuery.maybeSingle()
    if (loadError) return NextResponse.json({ error: 'Appointment could not be loaded' }, { status: 500 })
    if (!appointment) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })

    const now = new Date().toISOString()
    const { error: outcomeError } = await supabase
      .from('appointments')
      .update({
        status: outcome,
        ...(notes ? { notes } : {}),
        updated_at: now,
      })
      .eq('id', appointment.id)
      .eq('lead_id', leadId)
    if (outcomeError) {
      return NextResponse.json({ error: 'Appointment outcome could not be saved' }, { status: 500 })
    }

    const outcomeLabels: Record<Outcome, string> = {
      completed: 'Appointment completed',
      no_show: 'Appointment no-show',
      cancelled: 'Appointment cancelled',
      rescheduled: 'Appointment needs rescheduling',
    }
    const { error: activityError } = await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'appointment_outcome',
      description: outcomeLabels[outcome as Outcome] + (notes ? `: ${notes}` : ''),
      agent: actor.name,
      metadata: {
        appointment_id: appointment.id,
        outcome,
        notes: notes || null,
        recorded_at: now,
        actor_email: actor.email,
        source: 'appointment_outcome_review',
      },
    })

    let autoAdvance = null
    if (outcome === 'completed') {
      autoAdvance = await checkAutoAdvance(leadId, 'appointment_completed').catch((error) => {
        console.error('[appointment-outcome] lifecycle advance failed:', error)
        return null
      })
    }

    return NextResponse.json({
      success: true,
      appointmentId: appointment.id,
      outcome,
      autoAdvance,
      ...(activityError ? {
        warning: 'The outcome was saved, but its timeline entry is pending. Do not submit it again.',
      } : {}),
    })
  } catch (error) {
    console.error('[appointment-outcome] failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
