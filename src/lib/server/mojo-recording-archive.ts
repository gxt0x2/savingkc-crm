import { createHash } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'

import { downloadRecording } from '@/lib/mojo-recording-downloader'
import { supabaseAdmin } from '@/lib/supabase/admin'

import type { MojoCallIngestResult, MojoCallRecord } from './mojo-call-import'

export const MOJO_RECORDINGS_BUCKET = 'mojo-call-recordings'
export const MAX_MOJO_RECORDING_BYTES = 100 * 1024 * 1024

type ArchiveDependencies = {
  download: typeof downloadRecording
  read: typeof readFile
  remove: typeof unlink
  db: ReturnType<typeof supabaseAdmin>
}

type ArchiveInput = {
  eventId: string
  recordId: string
  recordingUrl: string
}

export type MojoRecordingArchiveBatch = {
  inspected: number
  archived: number
  failed: number
}

function storagePath(eventId: string): string {
  return `mojo/${eventId}.mp3`
}

export function mojoRecordingPlaybackUrl(eventId: string): string {
  return `/api/recordings/mojo/${encodeURIComponent(eventId)}`
}

export async function archiveMojoRecording(
  input: ArchiveInput,
  dependencies: Partial<ArchiveDependencies> = {},
): Promise<string | null> {
  if (!input.recordingUrl) return null

  const db = dependencies.db || supabaseAdmin()
  const { data: existing, error: lookupError } = await db
    .from('crm_mojo_call_events')
    .select('recording_storage_path')
    .eq('id', input.eventId)
    .single()

  if (lookupError) throw new Error(`Mojo recording archive lookup failed: ${lookupError.message}`)
  if (existing?.recording_storage_path) return mojoRecordingPlaybackUrl(input.eventId)

  const download = dependencies.download || downloadRecording
  const read = dependencies.read || readFile
  const remove = dependencies.remove || unlink
  const localPath = await download(input.recordingUrl, input.recordId)

  try {
    const audio = await read(localPath)
    if (audio.byteLength < 1_000) throw new Error('Mojo recording is empty or invalid')
    if (audio.byteLength > MAX_MOJO_RECORDING_BYTES) throw new Error('Mojo recording exceeds the 100 MB archive limit')

    const path = storagePath(input.eventId)
    const checksum = createHash('sha256').update(audio).digest('hex')
    const { error: uploadError } = await db.storage
      .from(MOJO_RECORDINGS_BUCKET)
      .upload(path, audio, { contentType: 'audio/mpeg', upsert: true })
    if (uploadError) throw new Error(`Mojo recording upload failed: ${uploadError.message}`)

    const { error: commitError } = await db.rpc('archive_crm_mojo_recording_v1', {
      p_event_id: input.eventId,
      p_storage_path: path,
      p_mime_type: 'audio/mpeg',
      p_byte_size: audio.byteLength,
      p_sha256: checksum,
    })
    if (commitError) throw new Error(`Mojo recording archive commit failed: ${commitError.message}`)

    return mojoRecordingPlaybackUrl(input.eventId)
  } finally {
    await remove(localPath).catch(() => undefined)
  }
}

export async function archiveCanonicalMojoRecording(
  result: MojoCallIngestResult,
  call: MojoCallRecord,
  dependencies: Partial<ArchiveDependencies> = {},
): Promise<string | null> {
  if (!call.recording_url) return null
  // Legacy activity-derived IDs cannot prove which provider recording belongs
  // to the call. Keep the evidence URL, but do not archive possibly mismatched audio.
  if (call.record_id.startsWith('mojo-activity-')) return null
  return archiveMojoRecording({
    eventId: result.eventId,
    recordId: call.record_id,
    recordingUrl: call.recording_url,
  }, dependencies)
}

export async function archivePendingMojoRecordings(
  limit = 2,
  dependencies: Pick<Partial<ArchiveDependencies>, 'download' | 'read' | 'remove' | 'db'> = {},
): Promise<MojoRecordingArchiveBatch> {
  const db = dependencies.db || supabaseAdmin()
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 5))
  const { data, error } = await db
    .from('crm_mojo_call_events')
    .select('id,record_id,recording_url')
    .not('recording_url', 'is', null)
    .not('record_id', 'like', 'mojo-activity-%')
    .is('recording_storage_path', null)
    .order('call_at', { ascending: true })
    .limit(boundedLimit)

  if (error) throw new Error(`Mojo recording backlog lookup failed: ${error.message}`)
  const rows = Array.isArray(data) ? data : []
  let archived = 0
  let failed = 0

  for (const row of rows) {
    if (!row?.id || !row.record_id || !row.recording_url) continue
    try {
      await archiveMojoRecording({
        eventId: row.id,
        recordId: row.record_id,
        recordingUrl: row.recording_url,
      }, { ...dependencies, db })
      archived++
    } catch (error) {
      failed++
      console.error('[Mojo recording] backlog archive failed:', row.record_id, error)
    }
  }

  return { inspected: rows.length, archived, failed }
}
