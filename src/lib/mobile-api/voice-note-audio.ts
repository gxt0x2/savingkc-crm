import { createHash } from 'node:crypto'
import { DOCUMENTS_BUCKET } from '@/lib/documents'
import { mobileCommandIdentityUuid } from '@/lib/mobile-api/command-receipts'
import { MobileAttachmentError, validateMobileMessageFile } from '@/lib/mobile-api/message-attachments'
import { supabaseAdmin } from '@/lib/supabase/admin'

export type VoiceNoteAudio = { documentId: string; durationSec: number; mimeType: string; byteSize: number }
export const VOICE_NOTE_AUDIO_TYPE = 'voice_note_audio'
export const VOICE_NOTE_MAX_DURATION_SEC = 300

export async function readVoiceNoteFile(file: unknown, duration: unknown) {
  if (!(file instanceof File)) throw new MobileAttachmentError('Choose a voice recording to save.', 400)
  const { mimeType } = validateMobileMessageFile(file)
  if (!mimeType.startsWith('audio/')) throw new MobileAttachmentError('A voice note requires an audio recording.', 415)
  const durationSec = Number(duration)
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > VOICE_NOTE_MAX_DURATION_SEC) {
    throw new MobileAttachmentError('Voice notes must be between 1 second and 5 minutes.', 400)
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  return { bytes, mimeType, durationSec, digest: createHash('sha256').update(bytes).digest('hex') }
}

/** Upload and metadata identities are stable, so a lost response never creates another object. */
export async function persistVoiceNoteAudio(db: ReturnType<typeof supabaseAdmin>, input: {
  actorEmail: string; leadId: string; key: string; audio: Awaited<ReturnType<typeof readVoiceNoteFile>>
}): Promise<VoiceNoteAudio> {
  const { actorEmail, leadId, key, audio } = input
  const documentId = mobileCommandIdentityUuid(actorEmail, key, 'voice_note_audio')
  const extension = audio.mimeType === 'audio/webm' ? 'webm' : audio.mimeType === 'audio/mp4' || audio.mimeType === 'audio/m4a' ? 'm4a' : audio.mimeType.split('/')[1].replace('x-', '')
  const filename = `voice-note.${extension}`
  const path = `lead/${leadId}/voice-notes/${documentId}.${extension}`
  const { data: bucket, error: bucketError } = await db.storage.getBucket(DOCUMENTS_BUCKET)
  if (bucketError || !bucket || bucket.public !== false) throw new MobileAttachmentError('Private voice-note storage is unavailable. Your recording is still on this device.', 503)
  const select = 'id,entity_type,entity_id,doc_type,filename,storage_path,mime_type,byte_size,uploaded_by'
  const existing = await db.from('documents').select(select).eq('id', documentId).maybeSingle()
  if (existing.error) throw new MobileAttachmentError('Voice-note storage could not be checked.', 503)
  let row = existing.data
  const verifyBytes = async () => {
    const { data, error } = await db.storage.from(DOCUMENTS_BUCKET).download(path)
    if (error || !data || createHash('sha256').update(new Uint8Array(await data.arrayBuffer())).digest('hex') !== audio.digest) {
      throw new MobileAttachmentError('The saved voice audio could not be reconciled. Keep the recording and retry this note.', 503)
    }
  }
  if (!row) {
    const uploaded = await db.storage.from(DOCUMENTS_BUCKET).upload(path, audio.bytes, { contentType: audio.mimeType, upsert: false })
    if (uploaded.error) await verifyBytes()
    const inserted = await db.from('documents').insert({
      id: documentId, entity_type: 'lead', entity_id: leadId, doc_type: VOICE_NOTE_AUDIO_TYPE,
      filename, storage_path: path, mime_type: audio.mimeType, byte_size: audio.bytes.length,
      uploaded_by: actorEmail, notes: 'Mobile voice note',
    }).select(select).single()
    if (inserted.error && inserted.error.code !== '23505') throw new MobileAttachmentError('Voice audio uploaded, but its note was not saved. Keep this draft and retry.', 503)
    if (inserted.error) {
      const recovered = await db.from('documents').select(select).eq('id', documentId).maybeSingle()
      if (recovered.error) throw new MobileAttachmentError('Voice-note metadata could not be reconciled.', 503)
      row = recovered.data
    } else row = inserted.data
  } else await verifyBytes()
  if (!row || row.entity_type !== 'lead' || row.entity_id !== leadId || row.doc_type !== VOICE_NOTE_AUDIO_TYPE
    || row.storage_path !== path || row.mime_type !== audio.mimeType || Number(row.byte_size) !== audio.bytes.length || row.uploaded_by !== actorEmail) {
    throw new MobileAttachmentError('Voice-note identity conflict.', 409)
  }
  return { documentId, durationSec: audio.durationSec, mimeType: audio.mimeType, byteSize: audio.bytes.length }
}

export function voiceNoteAudioMetadata(value: unknown): VoiceNoteAudio | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const audio = value as Record<string, unknown>
  if (typeof audio.documentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(audio.documentId)
    || typeof audio.durationSec !== 'number' || !Number.isFinite(audio.durationSec) || audio.durationSec <= 0 || audio.durationSec > VOICE_NOTE_MAX_DURATION_SEC
    || typeof audio.mimeType !== 'string' || !audio.mimeType.startsWith('audio/')
    || typeof audio.byteSize !== 'number' || audio.byteSize < 1 || audio.byteSize > 4 * 1024 * 1024) return null
  return { documentId: audio.documentId, durationSec: audio.durationSec, mimeType: audio.mimeType, byteSize: audio.byteSize }
}
