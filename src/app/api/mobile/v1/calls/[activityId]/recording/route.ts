import { Buffer } from 'node:buffer'
import { NextRequest, NextResponse } from 'next/server'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileUser } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError, requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import { twilioRecordingSid } from '@/lib/mobile-api/twilio-recording'
import { MOJO_RECORDING_BUCKET, mojoRecordingEventId, mojoRecordingStoragePath } from '@/lib/mobile-api/mojo-recording'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CALL_TYPES = new Set(['call', 'missed_call', 'voicemail'])

export function OPTIONS() { return mobileOptionsResponse() }

export async function GET(req: NextRequest, { params }: { params: Promise<{ activityId: string }> }) {
  try {
    const { activityId } = await params
    if (!UUID_PATTERN.test(activityId)) return NextResponse.json({ error: 'A valid call id is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    // Authenticate before looking up the activity. The linked lead must also be in the actor's scope.
    await requireMobileUser(req)
    const db = supabaseAdmin()
    const { data: activity, error } = await db.from('lead_activities')
      .select('id,lead_id,activity_type,metadata').eq('id', activityId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!activity?.lead_id || !CALL_TYPES.has(activity.activity_type)) {
      return NextResponse.json({ error: 'Recording not found.' }, { status: 404, headers: mobileNoStoreHeaders() })
    }
    await requireAuthorizedMobileLead(req, activity.lead_id)
    const metadata = (activity.metadata ?? {}) as Record<string, unknown>
    const mojoEventId = mojoRecordingEventId(metadata)
    if (mojoEventId) {
      const { data: event, error: eventError } = await db.from('crm_mojo_call_events')
        .select('id,lead_id,activity_id,recording_storage_path')
        .eq('id', mojoEventId).eq('lead_id', activity.lead_id).maybeSingle()
      if (eventError) throw new Error(eventError.message)
      const storagePath = mojoRecordingStoragePath(mojoEventId, event?.recording_storage_path)
      if (!event || event.activity_id !== activityId || !storagePath) return NextResponse.json({ error: 'Recording is not available.' }, { status: 404, headers: mobileNoStoreHeaders() })
      const { data: audio, error: downloadError } = await db.storage.from(MOJO_RECORDING_BUCKET).download(storagePath)
      if (downloadError || !audio) return NextResponse.json({ error: 'Recording is temporarily unavailable.' }, { status: 503, headers: mobileNoStoreHeaders() })
      const size = audio.size
      if (size < 1 || size > 50 * 1024 * 1024) return NextResponse.json({ error: 'Recording is not available.' }, { status: 502, headers: mobileNoStoreHeaders() })
      const headers = new Headers(mobileNoStoreHeaders())
      headers.set('Content-Type', 'audio/mpeg')
      headers.set('Accept-Ranges', 'bytes')
      const range = req.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/)
      if (range) {
        const suffix = !range[1] && range[2] ? Number(range[2]) : null
        const start = suffix === null ? Number(range[1]) : Math.max(0, size - suffix)
        const end = suffix === null && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
        if ((!range[1] && !range[2]) || suffix === 0 || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
          headers.set('Content-Range', `bytes */${size}`)
          return new NextResponse(null, { status: 416, headers })
        }
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
        headers.set('Content-Length', String(end - start + 1))
        return new NextResponse(audio.slice(start, end + 1), { status: 206, headers })
      }
      headers.set('Content-Length', String(size))
      return new NextResponse(audio, { status: 200, headers })
    }
    const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() || ''
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || ''
    if (!/^AC[0-9a-f]{32}$/i.test(accountSid) || !authToken) return NextResponse.json({ error: 'Recording is temporarily unavailable.' }, { status: 503, headers: mobileNoStoreHeaders() })
    const sid = twilioRecordingSid(metadata, accountSid)
    if (!sid) return NextResponse.json({ error: 'Recording not found.' }, { status: 404, headers: mobileNoStoreHeaders() })
    const upstreamHeaders = new Headers({ Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` })
    const range = req.headers.get('range')
    if (range && /^bytes=\d*-\d*$/.test(range)) upstreamHeaders.set('Range', range)
    const upstream = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${sid}.mp3`, {
      headers: upstreamHeaders,
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    if ((upstream.status !== 200 && upstream.status !== 206)
      || !upstream.headers.get('content-type')?.startsWith('audio/')) {
      return NextResponse.json({ error: 'Recording is temporarily unavailable.' }, { status: upstream.status === 404 ? 404 : 502, headers: mobileNoStoreHeaders() })
    }
    const headers = new Headers(mobileNoStoreHeaders())
    headers.set('Content-Type', 'audio/mpeg')
    headers.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes')
    for (const name of ['content-length', 'content-range']) {
      const value = upstream.headers.get(name)
      if (value) headers.set(name, value)
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers })
  } catch (error) {
    const known = error instanceof MobileAuthError || error instanceof MobileLeadAccessError
    const status = known ? error.status : 502
    const message = known ? error.message : 'Recording is temporarily unavailable.'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
