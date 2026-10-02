import { NextRequest, NextResponse } from 'next/server'

import { mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import { requireMobileCommandActor } from '@/lib/mobile-api/mobile-command-access'
import { mobileAppointmentErrorResponse, mobileAppointmentIdempotencyKey } from '@/lib/mobile-api/appointment-route'
import { buildMobileAppointmentCreate } from '@/lib/server/mobile-appointment-command'
import { executeMobileAppointmentCommand } from '@/lib/server/mobile-appointments'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(req: NextRequest) {
  try {
    const { actor } = await requireMobileCommandActor(req)
    const idempotencyKey = mobileAppointmentIdempotencyKey(req)
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'A stable Idempotency-Key is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const parsed = buildMobileAppointmentCreate(await req.json().catch(() => null), actor.name)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: mobileNoStoreHeaders() })
    await requireAuthorizedMobileLead(req, parsed.value.leadId)
    const result = await executeMobileAppointmentCommand({
      actor,
      idempotencyKey,
      command: 'create',
      leadId: parsed.value.leadId,
      payload: parsed.value,
    })
    return NextResponse.json(result, { status: result.created ? 201 : 200, headers: mobileNoStoreHeaders() })
  } catch (error) {
    console.error('[mobile/appointments] create failed', error)
    return mobileAppointmentErrorResponse(error)
  }
}
