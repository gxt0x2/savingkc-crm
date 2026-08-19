import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import twilio from 'twilio'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'
import { cleanTwilioEnv, requireTwilioEnv, resolveTwimlAppSid } from '@/lib/telephony/twiml-app'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const AccessToken = twilio.jwt.AccessToken
const VoiceGrant = AccessToken.VoiceGrant

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
  Vary: 'Authorization, Cookie',
}

export async function GET() {
  try {
    // Proxy-level trusted bearers are allowed to reach this route for legacy
    // health checks, but only a real CRM session may mint a Voice token.
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {},
        },
      }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: NO_STORE_HEADERS },
      )
    }

    const required = ['TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET'] as const
    const missing = required.filter((k) => !cleanTwilioEnv(k))
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required env vars: ${missing.join(', ')}` },
        { status: 500, headers: NO_STORE_HEADERS }
      )
    }

    const email = user.email.toLowerCase()

    // Authentication is the source of truth for both the Twilio client identity
    // and the first outbound line shown to the agent.
    const profile = resolveAgentTelephonyProfile(email)
    const { identity, defaultCallerId: callerId } = profile

    const twimlAppSid = await resolveTwimlAppSid()
    if (!twimlAppSid) {
      throw new Error('SavingKC CRM TwiML App is not configured')
    }
    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true,
    })
    const accountSid = requireTwilioEnv('TWILIO_ACCOUNT_SID', 'AC')
    const apiKey = requireTwilioEnv('TWILIO_API_KEY', 'SK')
    const apiSecret = requireTwilioEnv('TWILIO_API_SECRET')
    const token = new AccessToken(
      accountSid,
      apiKey,
      apiSecret,
      { identity, ttl: 3600 }
    )
    token.addGrant(voiceGrant)
    return NextResponse.json(
      { token: token.toJwt(), identity, callerId, twimlAppSid },
      { headers: NO_STORE_HEADERS }
    )
  } catch (err) {
    console.error('twilio-token error:', err)
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
