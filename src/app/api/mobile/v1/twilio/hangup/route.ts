import { NextRequest, NextResponse } from 'next/server'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileUser } from '@/lib/mobile-api/auth'
import { resolveMobileScopedActor } from '@/lib/mobile-api/authorized-lead'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'
import { hangupMobileVoiceCall, MobileHangupError } from '@/lib/telephony/mobile-voice-hangup'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(request: NextRequest) {
  const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: mobileNoStoreHeaders() })
  try {
    const { user } = await requireMobileUser(request)
    const email = user.email?.trim().toLowerCase()
    if (!email || !await resolveMobileScopedActor(email)) return json({ ok: false, error: 'CRM profile not authorized' }, 403)
    const body = await request.json().catch(() => null)
    if (typeof body?.callSid !== 'string') return json({ ok: false, error: 'callSid is required' }, 400)
    const result = await hangupMobileVoiceCall(body.callSid, resolveAgentTelephonyProfile(email).identity)
    return json({ ok: true, result })
  } catch (error) {
    const known = error instanceof MobileAuthError || error instanceof MobileHangupError
    return json({ ok: false, error: known ? error.message : 'Hang up is temporarily unavailable' }, known ? error.status : 503)
  }
}
