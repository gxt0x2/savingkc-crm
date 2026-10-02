import { NextRequest, NextResponse } from 'next/server'

import { mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { requireAuthorizedMobileAppointment } from '@/lib/mobile-api/mobile-command-access'
import { AppointmentCommandError } from '@/lib/server/mobile-appointments'
import { mobileAppointmentErrorResponse, mobileAppointmentIdempotencyKey } from '@/lib/mobile-api/appointment-route'
import { buildMobileAppointmentOutcome } from '@/lib/server/mobile-appointment-command'
import { executeMobileAppointmentCommand } from '@/lib/server/mobile-appointments'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { actor, leadId } = await requireAuthorizedMobileAppointment(req, id)
    const idempotencyKey = mobileAppointmentIdempotencyKey(req)
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'A stable Idempotency-Key is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const parsed = buildMobileAppointmentOutcome(await req.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: mobileNoStoreHeaders() })
    if (parsed.value.leadId !== leadId) throw new AppointmentCommandError('The appointment does not belong to that contact.', 'conflict')
    const result = await executeMobileAppointmentCommand({
      actor,
      idempotencyKey,
      command: 'outcome',
      appointmentId: id,
      leadId: parsed.value.leadId,
      expectedVersion: parsed.value.expectedVersion,
      payload: parsed.value.payload,
    })
    return NextResponse.json(result, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    console.error('[mobile/appointments] outcome failed', error)
    return mobileAppointmentErrorResponse(error)
  }
}
