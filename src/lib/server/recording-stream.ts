import 'server-only'

import { RECORDINGS_BUCKET, SIGNED_RECORDING_TTL_SECONDS, recordingStoragePath } from '@/lib/marketing/recording-playback'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function signedRecordingUrl(bucket: string, path: string): Promise<string | null> {
  const safe = recordingStoragePath(path)
  if (!safe) return null
  const { data, error } = await supabaseAdmin().storage.from(bucket).createSignedUrl(safe, SIGNED_RECORDING_TTL_SECONDS)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

export async function proxyAudio(
  upstreamUrl: string,
  headers: Record<string, string>,
  range: string | null,
): Promise<Response | null> {
  const requestHeaders = { ...headers }
  if (range) requestHeaders.Range = range
  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, { headers: requestHeaders, redirect: 'follow' })
  } catch {
    return null
  }
  if (!upstream.ok && upstream.status !== 206) return null
  const contentType = upstream.headers.get('content-type') || ''
  if (contentType.includes('text/html') || contentType.includes('application/json')) return null
  const responseHeaders = new Headers()
  responseHeaders.set('Content-Type', contentType || 'audio/mpeg')
  responseHeaders.set('Cache-Control', 'private, max-age=300')
  responseHeaders.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes')
  for (const name of ['content-length', 'content-range']) {
    const value = upstream.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}

export async function streamStoredRecording(path: string, range: string | null, bucket = RECORDINGS_BUCKET): Promise<Response | null> {
  const signed = await signedRecordingUrl(bucket, path)
  if (!signed) return null
  return proxyAudio(signed, {}, range)
}

export async function lookupTwilioStoragePath(sid: string): Promise<string | null> {
  const db = supabaseAdmin()
  const attempt = await db
    .from('dialer_session_attempts')
    .select('recording_storage_path')
    .eq('recording_sid', sid)
    .not('recording_storage_path', 'is', null)
    .limit(1)
    .maybeSingle()
  const attemptPath = recordingStoragePath(attempt.data?.recording_storage_path)
  if (!attempt.error && attemptPath) return attemptPath

  const activity = await db
    .from('lead_activities')
    .select('metadata')
    .eq('activity_type', 'call')
    .contains('metadata', { recordingSid: sid })
    .limit(5)
  if (activity.error || !Array.isArray(activity.data)) return null
  for (const row of activity.data) {
    const metadata = row?.metadata
    if (!metadata || typeof metadata !== 'object') continue
    const record = metadata as Record<string, unknown>
    const stored = recordingStoragePath(record.recording_storage_path)
      || recordingStoragePath(record.recordingStoragePath)
    if (stored && !stored.startsWith('events/') && !stored.startsWith('calls/')) return stored
    const publicPath = publicPathFrom(record.recordingUrl) || publicPathFrom(record.recording_url)
    if (publicPath) return publicPath
  }
  return null
}

function publicPathFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const marker = '/storage/v1/object/public/recordings/'
  const index = value.indexOf(marker)
  if (index < 0) return null
  return recordingStoragePath(value.slice(index + marker.length))
}
