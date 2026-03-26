import { NextResponse } from 'next/server'

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
    (a: { friendly_name: string; sid: string }) => a.friendly_name === 'SavingKC CRM'
  )?.sid

  if (!appSid) {
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
          FriendlyName: 'SavingKC CRM',
          VoiceUrl: 'https://crm.savingkc.com/api/twiml-voice',
          VoiceMethod: 'POST',
        }).toString(),
      }
    )
    const createData = await createRes.json()
    appSid = createData.sid
  }

  return NextResponse.json({ appSid })
}
