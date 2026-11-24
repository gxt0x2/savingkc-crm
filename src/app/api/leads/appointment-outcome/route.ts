/** Record a human-reviewed outcome on the canonical appointment row. */

import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { readAppointmentOutcomeDetails } from '@/lib/server/appointment-outcome-plan'
import { AppointmentOutcomeError, recordAppointmentOutcome } from '@/lib/server/appointment-outcome'

export async function POST(req: NextRequest) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as unknown
    const details = readAppointmentOutcomeDetails(body)
    if (!details.ok) return NextResponse.json({ error: details.error }, { status: details.status })
    if (!details.value.leadId) {
      return NextResponse.json({ error: 'A valid contact and outcome are required' }, { status: 400 })
    }

    const result = await recordAppointmentOutcome({
      actor,
      source: 'appointment_outcome_review',
      request: details.value,
    })
    return NextResponse.json({
      success: true,
      appointmentId: result.appointmentId,
      outcome: result.outcome,
      stage: result.stage,
      appointmentDate: result.appointmentDate,
      followUpTaskKey: result.followUpTaskKey,
      replacementAppointmentId: result.replacementAppointmentId,
    })
  } catch (error) {
    if (error instanceof AppointmentOutcomeError) {
      console.error('[appointment-outcome] failed:', error.message)
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[appointment-outcome] failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
