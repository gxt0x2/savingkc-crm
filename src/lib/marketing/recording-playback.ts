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
  return TWILIO_SID.test(sid) ? sid : null
}

export function twilioCallSid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const sid = value.trim()
  return CALL_SID.test(sid) ? sid : null
}

/** Prefix uppercase and hex lowercase. Comparisons only; stored SIDs stay as written. */
export function canonicalTwilioSid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(RE|CA)([0-9a-f]{32})$/i)
  if (!match?.[1] || !match[2]) return null
  return `${match[1].toUpperCase()}${match[2].toLowerCase()}`
}

export function twilioRecordingDownloadUrl(accountSid: string, recordingSid: string): string {
  const sid = canonicalTwilioSid(recordingSid)
  if (!sid?.startsWith('RE') || !/^AC[0-9a-f]{32}$/i.test(accountSid)) throw new Error('invalid_recording_sid')
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${sid}.mp3`
}

export type RecordingCopyRow = {
  id: string
  kind: string
  recordedAt: string
  leadId: string | null
  recordingUrl: string | null
  recordingSid: string | null
  callSid?: string | null
  storagePath: string | null
}

/** One identity per recording across attempts, calls, voicemails, notes, and Mojo. */
export function recordingCopyKey(row: RecordingCopyRow): string | null {
  const recording = canonicalTwilioSid(row.recordingSid)
  if (recording?.startsWith('RE')) return recording
  const call = canonicalTwilioSid(row.callSid)
  if (call?.startsWith('CA')) return call
  return mojoRecordingSourceUrl(row.recordingUrl)
}

const COPY_RANK: Record<string, number> = {
  twilio_attempt: 0,
  twilio_call: 1,
  twilio_note: 2,
  mojo_event: 3,
  mojo_call: 4,
}

export function plannedRecordingPath(row: RecordingCopyRow): string | null {
  const sid = twilioRecordingSid(row.recordingSid)
  try {
    if (sid && row.kind === 'twilio_attempt') return twilioStoragePath({ leadId: row.leadId, attemptId: row.id, recordingSid: sid })
    if (sid && (row.kind === 'twilio_call' || row.kind === 'twilio_note')) return twilioCallStoragePath({ leadId: row.leadId, callId: row.id, recordingSid: sid })
    if (row.kind === 'mojo_event') return mojoEventStoragePath(row.id)
    if (row.kind === 'mojo_call') return mojoCallStoragePath(row.id)
  } catch {
    return null
  }
  return null
}

/**
 * Download each recording once. If any row for that recording already has a
 * path, siblings are stamped with it and nothing is fetched again.
 */
export function selectRecordingWork<T extends RecordingCopyRow>(rows: readonly T[]): {
  downloads: T[]
  stamps: Array<{ target: T; storagePath: string }>
} {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = recordingCopyKey(row)
    if (!key) continue
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  const downloads: T[] = []
  const stamps: Array<{ target: T; storagePath: string }> = []
  for (const group of groups.values()) {
    const stored = group.find((row) => row.storagePath)
    if (stored?.storagePath) {
      for (const row of group) {
        if (!row.storagePath) stamps.push({ target: row, storagePath: stored.storagePath })
      }
      continue
    }
    const winner = [...group].sort((left, right) =>
      (COPY_RANK[left.kind] ?? 9) - (COPY_RANK[right.kind] ?? 9)
      || left.recordedAt.localeCompare(right.recordedAt)
      || left.id.localeCompare(right.id))[0]
    if (!winner) continue
    downloads.push(winner)
    const storagePath = plannedRecordingPath(winner)
    if (!storagePath) continue
    for (const row of group) {
      if (row !== winner) stamps.push({ target: row, storagePath })
    }
  }
  return { downloads, stamps }
}

export function archivedActivityMetadata(
  existing: Record<string, unknown>,
  storagePath: string,
  copiedAt: string,
): Record<string, unknown> {
  return {
    ...existing,
    recording_storage_path: storagePath,
    recording_copied_at: copiedAt,
  }
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
