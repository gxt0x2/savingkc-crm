import { NextRequest, NextResponse } from 'next/server'

import { mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { requireAuthorizedMobileAppointment } from '@/lib/mobile-api/mobile-command-access'
import { mobileAppointmentErrorResponse } from '@/lib/mobile-api/appointment-route'
import { MobileCalendarRetryError, syncMobileAppointmentCalendar } from '@/lib/server/mobile-appointment-calendar'
import { getMobileAppointmentById } from '@/lib/server/mobile-appointments'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { actor, leadId } = await requireAuthorizedMobileAppointment(req, id)
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !['expectedVersion', 'leadId'].includes(key))
      || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1
      || body.leadId !== leadId) {
      return NextResponse.json({ error: 'Contact and current appointment version are required.' }, {
        status: 400, headers: mobileNoStoreHeaders(),
      })
    }
    const sync = await syncMobileAppointmentCalendar({
      appointmentId: id,
      actorEmail: actor.email,
      expectedVersion: body.expectedVersion,
      requireOwner: true,
    })
    const appointment = await getMobileAppointmentById(id)
    return NextResponse.json({ success: true, appointment, ...(sync.warning ? { warning: sync.warning } : {}) }, {
      headers: mobileNoStoreHeaders(),
    })
  } catch (error) {
    if (error instanceof MobileCalendarRetryError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: mobileNoStoreHeaders() })
    }
    console.error('[mobile/appointments] calendar retry failed', error)
    return mobileAppointmentErrorResponse(error)
  }
}
