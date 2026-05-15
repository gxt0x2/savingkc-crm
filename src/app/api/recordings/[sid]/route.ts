import { NextResponse } from 'next/server'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!

// Forward Range requests + length/seek headers from Twilio so the browser
// can read MP3 duration immediately (powers the progress bar) and seek by
// dragging the scrubber. Without forwarding these, audio.duration stays NaN
// or Infinity and the player has no way to render progress.
export async function GET(req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${sid}.mp3`
  const credentials = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')

  const upstreamHeaders: Record<string, string> = {
    Authorization: `Basic ${credentials}`,
  }
  const range = req.headers.get('range')
  if (range) upstreamHeaders['Range'] = range

  const upstream = await fetch(twilioUrl, { headers: upstreamHeaders })

  if (!upstream.ok && upstream.status !== 206) {
    return new NextResponse('Recording not found', { status: 404 })
  }

  const headers = new Headers()
  headers.set('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg')
  headers.set('Cache-Control', 'private, max-age=3600')
  headers.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes')
  const length = upstream.headers.get('content-length')
  if (length) headers.set('Content-Length', length)
  const contentRange = upstream.headers.get('content-range')
  if (contentRange) headers.set('Content-Range', contentRange)

  return new NextResponse(upstream.body, { status: upstream.status, headers })
}
