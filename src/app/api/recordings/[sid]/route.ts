import { NextResponse } from 'next/server'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!

export async function GET(req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${sid}.mp3`
  const credentials = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')

  const upstream = await fetch(twilioUrl, {
    headers: { Authorization: `Basic ${credentials}` },
  })

  if (!upstream.ok) {
    return new NextResponse('Recording not found', { status: 404 })
  }

  const headers = new Headers()
  headers.set('Content-Type', 'audio/mpeg')
  headers.set('Cache-Control', 'private, max-age=3600')
  // Stream the body
  return new NextResponse(upstream.body, { status: 200, headers })
}
