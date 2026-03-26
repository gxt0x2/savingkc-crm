import { NextResponse } from 'next/server'
import twilio from 'twilio'

const AccessToken = twilio.jwt.AccessToken
const VoiceGrant = AccessToken.VoiceGrant

async function getOrCreateTwimlAppSid(): Promise<string | undefined> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const authToken = process.env.TWILIO_AUTH_TOKEN!
  const creds = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

  try {
    const listRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Applications.json`,
      { headers: { Authorization: `Basic ${creds}` } }
    )
    const listData = await listRes.json()
    const existing = listData.applications?.find(
      (a: { friendly_name: string; sid: string }) => a.friendly_name === 'SavingKC CRM'
    )
    if (existing) return existing.sid

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
          VoiceUrl: 'https://crm.savingkc.com/api/twiml-voice',
          VoiceMethod: 'POST',
        }).toString(),
      }
    )
    const data = await createRes.json()
    return data.sid
  } catch {
    return undefined
  }
}

export async function GET() {
  try {
    const twimlAppSid = await getOrCreateTwimlAppSid()
    const identity = 'crm-user'
    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true,
    })
    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_API_KEY!,
      process.env.TWILIO_API_SECRET!,
      { identity, ttl: 3600 }
    )
    token.addGrant(voiceGrant)
    return NextResponse.json({ token: token.toJwt(), identity, twimlAppSid })
  } catch (err) {
    console.error('twilio-token error:', err)
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
  }
}
