import { NextRequest, NextResponse } from 'next/server'
import { DOCUMENTS_BUCKET } from '@/lib/documents'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError, requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import { voiceNoteAudioMetadata, VOICE_NOTE_AUDIO_TYPE } from '@/lib/mobile-api/voice-note-audio'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export function OPTIONS() { return mobileOptionsResponse() }

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  try {
    const { id, noteId } = await params
    await requireAuthorizedMobileLead(req, id)
    const db = supabaseAdmin()
    const note = await db.from('lead_activities').select('metadata').eq('id', noteId).eq('lead_id', id).eq('activity_type', 'note').maybeSingle()
    if (note.error) throw new Error('Voice note could not be loaded.')
    const audio = voiceNoteAudioMetadata((note.data?.metadata as Record<string, unknown> | null)?.voice_note_audio)
    if (!audio) return NextResponse.json({ error: 'This note has no saved audio.' }, { status: 404, headers: mobileNoStoreHeaders() })
    const doc = await db.from('documents').select('storage_path,mime_type,byte_size').eq('id', audio.documentId)
      .eq('entity_type', 'lead').eq('entity_id', id).eq('doc_type', VOICE_NOTE_AUDIO_TYPE).maybeSingle()
    if (doc.error) throw new Error('Voice audio could not be loaded.')
    if (!doc.data || doc.data.mime_type !== audio.mimeType || Number(doc.data.byte_size) !== audio.byteSize
      || !doc.data.storage_path.startsWith(`lead/${id}/voice-notes/${audio.documentId}.`)) {
      return NextResponse.json({ error: 'Saved voice audio is unavailable.' }, { status: 404, headers: mobileNoStoreHeaders() })
    }
    const bucket = await db.storage.getBucket(DOCUMENTS_BUCKET)
    if (bucket.error || bucket.data?.public !== false) throw new Error('Private voice-note storage is unavailable.')
    const signed = await db.storage.from(DOCUMENTS_BUCKET).createSignedUrl(doc.data.storage_path, 5 * 60)
    if (signed.error || !signed.data?.signedUrl) throw new Error('Voice audio could not be opened. Try again.')
    return NextResponse.json({ url: signed.data.signedUrl, mimeType: audio.mimeType, expiresIn: 300 }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError || error instanceof MobileLeadAccessError ? error.status : 503
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Voice audio could not be opened.' }, { status, headers: mobileNoStoreHeaders() })
  }
}
