import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MOJO_RECORDING_BUCKET = 'mojo-call-recordings'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function readSessionId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const nested = (value as Record<string, unknown>).sessionId
    return typeof nested === 'string' && nested.trim() ? nested.trim() : null
  }
  return null
}

function readMojoRecordingUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:') return null
    if (parsed.hostname !== 'mojosells.com' && !parsed.hostname.endsWith('.mojosells.com')) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function recordingHeaders(upstream: Response): Headers {
  const headers = new Headers()
  headers.set('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg')
  headers.set('Cache-Control', 'private, max-age=300')
  headers.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes')
  for (const name of ['content-length', 'content-range']) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const unauthorized = await requireAuthenticatedUser()
  if (unauthorized) return unauthorized

  const { eventId } = await params
  if (!UUID_PATTERN.test(eventId)) {
    return NextResponse.json({ error: 'Invalid recording reference' }, { status: 400 })
  }

  const db = supabaseAdmin()
  const { data: event, error } = await db
    .from('crm_mojo_call_events')
    .select('lead_id,recording_url,recording_storage_path')
    .eq('id', eventId)
    .maybeSingle()
  if (error || !event?.lead_id) return new NextResponse('Recording not found', { status: 404 })

  let upstreamUrl: string | null = null
  let upstreamHeaders: Record<string, string> = {}
  const range = request.headers.get('range')
  if (range) upstreamHeaders.Range = range

  if (typeof event.recording_storage_path === 'string' && event.recording_storage_path.trim()) {
    const { data: signed, error: signedError } = await db.storage
      .from(MOJO_RECORDING_BUCKET)
      .createSignedUrl(event.recording_storage_path, 60)
    if (!signedError && signed?.signedUrl) upstreamUrl = signed.signedUrl
  }

  if (!upstreamUrl) {
    upstreamUrl = readMojoRecordingUrl(event.recording_url)
    if (!upstreamUrl) return new NextResponse('Recording not found', { status: 404 })
    const { data: config } = await db
      .from('system_config')
      .select('value')
      .eq('key', 'mojo_session_id')
      .maybeSingle()
    const storedSession = readSessionId(config?.value)
    if (!storedSession) return new NextResponse('Recording is temporarily unavailable', { status: 503 })
    upstreamHeaders = {
      ...upstreamHeaders,
      cookie: `sessionid=${storedSession}`,
      referer: 'https://app71.mojosells.com/',
      accept: 'audio/mpeg, audio/*, */*',
      'user-agent': 'SavingKC CRM recording proxy',
    }
  }

  const upstream = await fetch(upstreamUrl, { headers: upstreamHeaders, redirect: 'follow' })
  if (!upstream.ok && upstream.status !== 206) {
    const status = upstream.status === 401 || upstream.status === 403 ? 503 : 404
    return new NextResponse('Recording is temporarily unavailable', { status })
  }
  const contentType = upstream.headers.get('content-type') || ''
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    return new NextResponse('Recording is temporarily unavailable', { status: 503 })
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers: recordingHeaders(upstream) })
}
