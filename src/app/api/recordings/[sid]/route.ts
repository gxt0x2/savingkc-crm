import { NextResponse } from 'next/server'
import { twilioRecordingAuthorization } from '@/lib/server/call-recording-archive'
import { lookupTwilioStoragePath, proxyAudio, streamStoredRecording } from '@/lib/server/recording-stream'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Stored copy first, then the live Twilio recording. Range headers stay
// forwarded so the browser can read duration and seek.
export async function GET(request: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params
  const range = request.headers.get('range')

  if (/^RE[0-9a-f]{32}$/i.test(sid)) {
    try {
      const storedPath = await lookupTwilioStoragePath(sid)
      if (storedPath) {
        const stored = await streamStoredRecording(storedPath, range)
        if (stored) return stored
      }
    } catch {
      // A missing archive column or object still falls through to Twilio.
    }
  }

  const auth = twilioRecordingAuthorization()
  if (!auth) return new NextResponse('Recording not found', { status: 404 })
  const live = await proxyAudio(
    `https://api.twilio.com/2010-04-01/Accounts/${auth.accountSid}/Recordings/${encodeURIComponent(sid)}.mp3`,
    { Authorization: auth.authorization },
    range,
  )
  if (!live) return new NextResponse('Recording not found', { status: 404 })
  return live
}
