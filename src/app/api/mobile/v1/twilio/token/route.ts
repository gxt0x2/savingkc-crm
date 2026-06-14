import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { requireMobileUser, mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

const AccessToken = twilio.jwt.AccessToken
const VoiceGrant = AccessToken.VoiceGrant

function cleanEnv(name: string): string {
  return process.env[name]?.replace(/\\[rnt]/g, '').replace(/\s+/g, '').trim() ?? ''
}

function identityFromEmail(email: string | undefined): string {
  const normalized = (email || 'mobile-user').toLowerCase()
  if (normalized.includes('casey')) return 'casey'
  if (normalized.includes('ernest')) return 'ernest'
  return normalized.replace(/[^a-z0-9_-]/g, '-').slice(0, 80) || 'mobile-user'
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireMobileUser(req)
    const accountSid = cleanEnv('TWILIO_ACCOUNT_SID')
    const apiKey = cleanEnv('TWILIO_API_KEY')
    const apiSecret = cleanEnv('TWILIO_API_SECRET')
    const outgoingApplicationSid = cleanEnv('TWILIO_TWIML_APP_SID')

    const missing = [
      !accountSid && 'TWILIO_ACCOUNT_SID',
      !apiKey && 'TWILIO_API_KEY',
      !apiSecret && 'TWILIO_API_SECRET',
      !outgoingApplicationSid && 'TWILIO_TWIML_APP_SID',
    ].filter(Boolean)

    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required env vars: ${missing.join(', ')}` },
        { status: 500, headers: mobileNoStoreHeaders() },
      )
    }

    const identity = identityFromEmail(user.email)
    const token = new AccessToken(accountSid, apiKey, apiSecret, { identity, ttl: 3600 })
    token.addGrant(new VoiceGrant({ outgoingApplicationSid, incomingAllow: true }))

    return NextResponse.json(
      {
        token: token.toJwt(),
        identity,
      },
      { headers: mobileNoStoreHeaders() },
    )
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof MobileAuthError ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
