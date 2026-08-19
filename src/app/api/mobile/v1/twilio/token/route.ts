import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { requireMobileUser, mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'
import { cleanTwilioEnv, resolveTwimlAppSid } from '@/lib/telephony/twiml-app'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

const AccessToken = twilio.jwt.AccessToken
const VoiceGrant = AccessToken.VoiceGrant
const CALLING_UNAVAILABLE = 'Calling is temporarily unavailable'

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireMobileUser(req)
    const accountSid = cleanTwilioEnv('TWILIO_ACCOUNT_SID')
    const apiKey = cleanTwilioEnv('TWILIO_API_KEY')
    const apiSecret = cleanTwilioEnv('TWILIO_API_SECRET')

    const missing = [
      !accountSid && 'TWILIO_ACCOUNT_SID',
      !apiKey && 'TWILIO_API_KEY',
      !apiSecret && 'TWILIO_API_SECRET',
    ].filter(Boolean)

    if (missing.length > 0) {
      return NextResponse.json(
        { error: CALLING_UNAVAILABLE },
        { status: 503, headers: mobileNoStoreHeaders() },
      )
    }

    const outgoingApplicationSid = await resolveTwimlAppSid()
    if (!outgoingApplicationSid) {
      return NextResponse.json(
        { error: CALLING_UNAVAILABLE },
        { status: 503, headers: mobileNoStoreHeaders() },
      )
    }

    const profile = resolveAgentTelephonyProfile(user.email)
    const { identity } = profile
    const token = new AccessToken(accountSid, apiKey, apiSecret, { identity, ttl: 3600 })
    token.addGrant(new VoiceGrant({ outgoingApplicationSid, incomingAllow: true }))

    return NextResponse.json(
      {
        token: token.toJwt(),
        identity,
        callerId: profile.defaultCallerId,
        displayName: profile.displayName,
      },
      { headers: mobileNoStoreHeaders() },
    )
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 503
    const message = error instanceof MobileAuthError ? error.message : CALLING_UNAVAILABLE
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
