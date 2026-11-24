import { NextRequest, NextResponse } from 'next/server'
import { requireMobileUser, mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

const OUTCOMES = new Set(['registered', 'error', 'push_registry_error'])

/**
 * The phone reports the result of Twilio Voice register(). Twilio does not
 * expose Voice push bindings, so this log line is the only server-side proof
 * that a device can receive an incoming <Client> invite through PushKit.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireMobileUser(req)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const outcome = typeof body.outcome === 'string' && OUTCOMES.has(body.outcome) ? body.outcome : 'unknown'
    const code = typeof body.code === 'number' || typeof body.code === 'string' ? String(body.code).slice(0, 12) : null
    const message = typeof body.message === 'string' ? body.message.slice(0, 200) : null
    const appBuild = typeof body.appBuild === 'string' ? body.appBuild.slice(0, 24) : null
    const identity = user.email ? resolveAgentTelephonyProfile(user.email.trim().toLowerCase()).identity : null
    console.info('[mobile-voice-registration]', {
      identity,
      outcome,
      code,
      message,
      appBuild,
      pushRegistryReady: body.pushRegistryReady === true,
      incomingPushConfigured: body.incomingPushConfigured === true,
    })
    return NextResponse.json({ ok: true }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 400
    return NextResponse.json({ error: 'not recorded' }, { status, headers: mobileNoStoreHeaders() })
  }
}
