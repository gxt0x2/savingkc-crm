import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { oauthReviewForeignLeadResponse } from '@/lib/auth/oauth-review-sandbox-session'
import { deleteCrmAppointment, readDeleteAppointmentCommand } from '@/lib/server/delete-appointment'

/**
 * POST /api/leads/delete-appointment
 * Hard-deletes one canonical appointment for an authenticated CRM operator.
 * Cancel remains the separate outcome that keeps the row.
 */
export async function POST(req: NextRequest) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = readDeleteAppointmentCommand(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  const hiddenLead = await oauthReviewForeignLeadResponse(parsed.leadId, req)
  if (hiddenLead) return hiddenLead

  try {
    const result = await deleteCrmAppointment({
      leadId: parsed.leadId,
      appointmentId: parsed.appointmentId,
      scheduledAt: parsed.scheduledAt,
      actor,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({
      success: true,
      appointmentId: result.appointmentId,
      deleted: result.deleted,
      rolledBack: result.rolledBack,
      station: result.station,
      googleCalendar: result.googleCalendar,
      ...(result.warnings.length > 0 ? { warning: result.warnings.join(' ') } : {}),
    })
  } catch (error) {
    console.error('[delete-appointment] failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
