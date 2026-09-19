import { NextRequest, NextResponse } from 'next/server'

import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileUser } from '@/lib/mobile-api/auth'
import { hangupMobileVoiceCall } from '@/lib/telephony/mobile-voice-hangup'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: mobileNoStoreHeaders() })
}

export async function POST(request: NextRequest) {
  try {
    await requireMobileUser(request)
    const body = await request.json().catch(() => null) as { callSid?: unknown } | null
    const callSid = typeof body?.callSid === 'string' ? body.callSid.trim() : ''
    if (!callSid) return json({ ok: false, error: 'callSid is required' }, 400)

    const result = await hangupMobileVoiceCall(callSid)
    return json({ ok: true, result })
  } catch (error) {
    const status = error instanceof MobileAuthError
      ? error.status
      : error instanceof Error && error.message === 'Calling is temporarily unavailable'
        ? 503
        : error instanceof Error && /valid Twilio call SID/.test(error.message)
          ? 400
          : 500
    const message = error instanceof MobileAuthError || error instanceof Error
      ? error.message
      : 'Hang up failed'
    return json({ ok: false, error: message }, status)
  }
}
