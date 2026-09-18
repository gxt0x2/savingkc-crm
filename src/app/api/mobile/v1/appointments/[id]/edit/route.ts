import { NextRequest, NextResponse } from 'next/server'

import { mobileNoStoreHeaders, mobileOptionsResponse, requireMobileActor } from '@/lib/mobile-api/auth'
import { mobileAppointmentErrorResponse, mobileAppointmentIdempotencyKey } from '@/lib/mobile-api/appointment-route'
import { buildMobileAppointmentEdit } from '@/lib/server/mobile-appointment-command'
import { executeMobileAppointmentCommand } from '@/lib/server/mobile-appointments'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireMobileActor(req)
    const idempotencyKey = mobileAppointmentIdempotencyKey(req)
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'A stable Idempotency-Key is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const parsed = buildMobileAppointmentEdit(await req.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: mobileNoStoreHeaders() })
    const { id } = await params
    const result = await executeMobileAppointmentCommand({
      actor,
      idempotencyKey,
      command: 'edit',
      appointmentId: id,
      expectedVersion: parsed.value.expectedVersion,
      payload: parsed.value.patch,
    })
    return NextResponse.json(result, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    console.error('[mobile/appointments] edit failed', error)
    return mobileAppointmentErrorResponse(error)
  }
}
