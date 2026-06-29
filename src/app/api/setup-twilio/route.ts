import { NextResponse } from 'next/server'

const TWIML_APP_FRIENDLY_NAME = 'SavingKC CRM'
const CANONICAL_VOICE_URL = 'https://crm.savingkc.com/api/twiml-voice'

export async function GET() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const authToken = process.env.TWILIO_AUTH_TOKEN!
  const creds = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

  // List existing TwiML apps
  const listRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Applications.json`,
    { headers: { Authorization: `Basic ${creds}` } }
  )
  const listData = await listRes.json()

  let appSid = listData.applications?.find(
    (a: { friendly_name: string; sid: string }) => a.friendly_name === TWIML_APP_FRIENDLY_NAME
  )?.sid

  if (appSid) {
    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Applications/${appSid}.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${creds}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          VoiceUrl: CANONICAL_VOICE_URL,
          VoiceMethod: 'POST',
        }).toString(),
      }
    )
  } else {
    // Create it with a voice URL that handles outbound calls
    const createRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Applications.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${creds}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          FriendlyName: TWIML_APP_FRIENDLY_NAME,
          VoiceUrl: CANONICAL_VOICE_URL,
          VoiceMethod: 'POST',
        }).toString(),
      }
    )
    const createData = await createRes.json()
    appSid = createData.sid
  }

  return NextResponse.json({ appSid, voiceUrl: CANONICAL_VOICE_URL })
}
