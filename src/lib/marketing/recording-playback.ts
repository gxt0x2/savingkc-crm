export const RECORDINGS_BUCKET = 'recordings'
export const MOJO_RECORDING_BUCKET = 'mojo-call-recordings'
export const SIGNED_RECORDING_TTL_SECONDS = 60

const STORAGE_PATH = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,220}\.(mp3|wav)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TWILIO_SID = /^RE[0-9a-f]{32}$/i
const CALL_SID = /^CA[0-9a-f]{32}$/i
const PUBLIC_RECORDING_MARKER = '/storage/v1/object/public/recordings/'

export type PlaybackSource = 'stored' | 'provider'

export function recordingStoragePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = safeDecode(value.trim().split(/[?#]/)[0] || '')
  if (!path || path.includes('..') || path.includes('//') || path.startsWith('/')) return null
  return STORAGE_PATH.test(path) ? path : null
}

/** Paths that live in the private Twilio recordings bucket, not the Mojo bucket. */
export function recordingsBucketPath(value: unknown): string | null {
  const path = recordingStoragePath(value)
  if (!path || path.startsWith('events/') || /^calls\/[0-9a-f-]{36}\.(?:mp3|wav)$/i.test(path)) return null
  return path
}

export function publicRecordingObjectPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.includes(PUBLIC_RECORDING_MARKER)) return null
  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== 'https:') return null
    if (parsed.hostname !== 'supabase.co' && !parsed.hostname.endsWith('.supabase.co')) return null
  } catch {
    return null
  }
  const raw = value.slice(value.indexOf(PUBLIC_RECORDING_MARKER) + PUBLIC_RECORDING_MARKER.length)
  return recordingStoragePath(raw)
}

export function signedRecordingRoute(path: string): string {
  return `/api/recordings?path=${encodeURIComponent(path)}`
}

export function playbackFallbackOrder(input: {
  storagePath?: string | null
  providerAvailable: boolean
}): PlaybackSource[] {
  const order: PlaybackSource[] = []
  if (recordingStoragePath(input.storagePath) || recordingsBucketPath(input.storagePath)) order.push('stored')
  if (input.providerAvailable) order.push('provider')
  return order
}

export async function openPlayback(input: {
  storagePath?: string | null
  providerAvailable: boolean
  openStored: () => Promise<boolean>
  openProvider: () => Promise<boolean>
}): Promise<PlaybackSource | null> {
  for (const source of playbackFallbackOrder(input)) {
    if (source === 'stored') {
      if (await input.openStored()) return 'stored'
      continue
    }
    if (await input.openProvider()) return 'provider'
  }
  return null
}

export function mojoRecordingSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    if (parsed.hostname !== 'mojosells.com' && !parsed.hostname.endsWith('.mojosells.com')) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function twilioRecordingSid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const sid = value.trim()
  return TWILIO_SID.test(sid) ? sid.toUpperCase() : null
}

export function twilioCallSid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const sid = value.trim()
  return CALL_SID.test(sid) ? sid.toUpperCase() : null
}

export function recordingSidFromCallMetadata(metadata: unknown): { recordingSid: string | null; callSid: string | null } {
  const meta = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {}
  const recordingSid = twilioRecordingSid(meta.recordingSid)
    || twilioRecordingSid(meta.RecordingSid)
    || twilioRecordingSid(meta.recording_sid)
    || recordingSidFromUrl(meta.recordingUrl)
    || recordingSidFromUrl(meta.recording_url)
    || recordingSidFromUrl(meta.RecordingUrl)
  const callSid = twilioCallSid(meta.callSid)
    || twilioCallSid(meta.CallSid)
    || twilioCallSid(meta.parentCallSid)
    || twilioCallSid(meta.call_sid)
  return { recordingSid, callSid }
}

function recordingSidFromUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.match(/\/(?:api\/recordings|Recordings)\/(RE[0-9a-f]{32})(?:\.[a-z0-9]+)?/i)
  return match ? twilioRecordingSid(match[1]) : null
}

export function twilioStoragePath(input: {
  leadId: string | null
  attemptId: string
  recordingSid: string
}): string {
  const sid = twilioRecordingSid(input.recordingSid)
  if (!sid) throw new Error('invalid_recording_sid')
  const file = `twilio_${sid}.mp3`
  if (input.leadId && UUID.test(input.leadId)) return `leads/${input.leadId}/${file}`
  if (UUID.test(input.attemptId)) return `attempts/${input.attemptId}/${file}`
  throw new Error('recording_target_missing')
}

export function twilioCallStoragePath(input: {
  leadId: string | null
  callId: string
  recordingSid: string
}): string {
  const sid = twilioRecordingSid(input.recordingSid)
  if (!sid) throw new Error('invalid_recording_sid')
  const file = `twilio_${sid}.mp3`
  if (input.leadId && UUID.test(input.leadId)) return `leads/${input.leadId}/${file}`
  if (UUID.test(input.callId)) return `calls/${input.callId}/${file}`
  throw new Error('recording_target_missing')
}

export function mojoEventStoragePath(eventId: string): string {
  if (!UUID.test(eventId)) throw new Error('invalid_mojo_event')
  return `events/${eventId}.mp3`
}

export function mojoCallStoragePath(callId: string): string {
  if (!UUID.test(callId)) throw new Error('invalid_mojo_call')
  return `calls/${callId}.mp3`
}

export function mojoRecordingUrlFromReportRow(row: unknown): { callId: string; url: string } | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  const record = row as Record<string, unknown>
  const callId = record.call_id
  const id = typeof callId === 'number' || typeof callId === 'string' ? String(callId).trim() : ''
  if (!/^\d{1,18}$/.test(id)) return null
  const url = mojoRecordingSourceUrl(record.audio ?? record.recording_url ?? record.url)
  return url ? { callId: id, url } : null
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
