import { NextRequest, NextResponse } from 'next/server'
import { mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { requireAuthorizedMobileAppointment } from '@/lib/mobile-api/mobile-command-access'
import { mobileAppointmentErrorResponse } from '@/lib/mobile-api/appointment-route'
import { getMobileAppointmentById } from '@/lib/server/mobile-appointments'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export function OPTIONS() { return mobileOptionsResponse() }
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await requireAuthorizedMobileAppointment(req, id)
    return NextResponse.json({ appointment: await getMobileAppointmentById(id) }, { headers: mobileNoStoreHeaders() })
  } catch (error) { return mobileAppointmentErrorResponse(error) }
}
