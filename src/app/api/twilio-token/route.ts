import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import twilio from 'twilio'

const AccessToken = twilio.jwt.AccessToken
const VoiceGrant = AccessToken.VoiceGrant

// Map email → outbound caller ID
const AGENT_CALLER_IDS: Record<string, string> = {
  'ernest@savingkc.com': '+18166088588', // Ernest's company number
  'casey@savingkc.com':  '+18167277667', // Casey's company number
}
const DEFAULT_CALLER_ID = '+18163077835' // fallback: main Twilio number

function env(name: string): string {
  return process.env[name]?.trim() ?? ''
}

function twilioEnv(name: string): string {
  return env(name)
    .replace(/\\[rnt]/g, '')
    .replace(/\s+/g, '')
}

function requireTwilioEnv(name: string, expectedPrefix?: string): string {
  const value = twilioEnv(name)
  if (!value) throw new Error(`${name} is not configured`)
  if (expectedPrefix && !value.startsWith(expectedPrefix)) {
    throw new Error(`${name} is malformed`)
  }
  return value
}

async function getOrCreateTwimlAppSid(): Promise<string | undefined> {
  const accountSid = requireTwilioEnv('TWILIO_ACCOUNT_SID', 'AC')
  // Use API Key credentials (more reliable than rotating auth tokens)
  const apiKey = requireTwilioEnv('TWILIO_API_KEY', 'SK')
  const apiSecret = requireTwilioEnv('TWILIO_API_SECRET')
  const creds = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')
  const voiceUrl = `${env('NEXT_PUBLIC_APP_URL') || 'https://crm.savingkc.com'}/api/twiml-voice`

  try {
    const listRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Applications.json`,
      { headers: { Authorization: `Basic ${creds}` } }
    )
    const listData = await listRes.json()
    const existing = listData.applications?.find(
      (a: { friendly_name: string; sid: string }) => a.friendly_name === 'SavingKC CRM'
    )
    if (existing) {
      // Update VoiceUrl in case it's stale (e.g. old tunnel URL)
      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Applications/${existing.sid}.json`,
        {
          method: 'POST',
          headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ VoiceUrl: voiceUrl, VoiceMethod: 'POST' }).toString(),
        }
      )
      return existing.sid
    }

    const createRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Applications.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${creds}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          FriendlyName: 'SavingKC CRM',
          VoiceUrl: voiceUrl,
          VoiceMethod: 'POST',
        }).toString(),
      }
    )
    const data = await createRes.json()
    return data.sid
  } catch {
    // Fallback to known SID if API call fails
    return twilioEnv('TWILIO_TWIML_APP_SID')
  }
}

export async function GET() {
  try {
    // Get logged-in user
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
    const email = user?.email?.toLowerCase() || ''

    // Derive identity + caller ID from email
    const identity = email.includes('casey') ? 'casey' : email.includes('ernest') ? 'ernest' : 'crm-user'
    const callerId = AGENT_CALLER_IDS[email] || DEFAULT_CALLER_ID

    const accountSid = requireTwilioEnv('TWILIO_ACCOUNT_SID', 'AC')
    const apiKey = requireTwilioEnv('TWILIO_API_KEY', 'SK')
    const apiSecret = requireTwilioEnv('TWILIO_API_SECRET')
    const twimlAppSid = await getOrCreateTwimlAppSid()
    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true,
    })
    const token = new AccessToken(
      accountSid,
      apiKey,
      apiSecret,
      { identity, ttl: 3600 }
    )
    token.addGrant(voiceGrant)
    return NextResponse.json({ token: token.toJwt(), identity, callerId, twimlAppSid })
  } catch (err) {
    console.error('twilio-token error:', err)
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
  }
}
