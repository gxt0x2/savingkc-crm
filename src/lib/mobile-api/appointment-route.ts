import { NextResponse } from 'next/server'

import { MobileAuthError, mobileNoStoreHeaders } from '@/lib/mobile-api/auth'
import { AppointmentCommandError } from '@/lib/server/mobile-appointments'

export function mobileAppointmentIdempotencyKey(req: Request): string | null {
  const key = req.headers.get('idempotency-key')?.trim() || ''
  return key.length >= 8 && key.length <= 200 ? key : null
}

export function mobileAppointmentErrorResponse(error: unknown) {
  if (error instanceof MobileAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: mobileNoStoreHeaders() })
  }
  if (error instanceof AppointmentCommandError) {
    const status = error.code === 'invalid' ? 400
      : error.code === 'not_found' ? 404
        : error.code === 'conflict' ? 409
          : 503
    return NextResponse.json({ error: error.message }, { status, headers: mobileNoStoreHeaders() })
  }
  return NextResponse.json({ error: 'Appointment command could not be completed.' }, { status: 503, headers: mobileNoStoreHeaders() })
}
