import { NextRequest, NextResponse } from 'next/server'

import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError, requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import { completeMobileCommand, mobileCommandIdentityUuid, mobileCommandPayloadHash, reserveMobileCommand } from '@/lib/mobile-api/command-receipts'
import { buildLeadActivityInsert } from '@/lib/server/lead-activity-command'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { MobileAttachmentError } from '@/lib/mobile-api/message-attachments'
import { persistVoiceNoteAudio, readVoiceNoteFile, voiceNoteAudioMetadata } from '@/lib/mobile-api/voice-note-audio'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { actor } = await requireAuthorizedMobileLead(req, id)
    const key = req.headers.get('idempotency-key')?.trim() || ''
    if (key.length < 8 || key.length > 200) return NextResponse.json({ error: 'A stable Idempotency-Key is required' }, { status: 400, headers: mobileNoStoreHeaders() })
    const multipart = req.headers.get('content-type')?.startsWith('multipart/form-data')
    const form = multipart ? await req.formData() : null
    const body = form ? { description: form.get('description') } : await req.json().catch(() => null) as { description?: unknown } | null
    const audio = form ? await readVoiceNoteFile(form.get('file'), form.get('durationSec')) : null
    const command = buildLeadActivityInsert(id, actor.fullName, { kind: 'note', description: body?.description })
    if (!command.ok) return NextResponse.json({ error: command.error }, { status: 400, headers: mobileNoStoreHeaders() })
    command.insert.metadata = { ...command.insert.metadata, actor_email: actor.email, idempotency_key: key, source: 'mobile_app' }
    const reservation = await reserveMobileCommand({
      actorEmail: actor.email, idempotencyKey: key, command: 'add_note', leadId: id,
      payloadHash: mobileCommandPayloadHash({ leadId: id, description: command.insert.description,
        ...(audio ? { audio: { digest: audio.digest, mimeType: audio.mimeType, durationSec: audio.durationSec } } : {}),
      }),
    })
    if (reservation.kind === 'conflict') return NextResponse.json({ error: 'That Idempotency-Key belongs to a different note' }, { status: 409, headers: mobileNoStoreHeaders() })
    if (reservation.kind === 'pending') return NextResponse.json({ error: 'This note is already processing. Refresh before retrying.', code: 'operation_pending' }, { status: 409, headers: mobileNoStoreHeaders() })
    if (reservation.kind === 'replay') return NextResponse.json(reservation.result, { status: reservation.status, headers: mobileNoStoreHeaders() })
    const activityId = mobileCommandIdentityUuid(actor.email, key, 'add_note')
    const db = supabaseAdmin()
    if (audio) command.insert.metadata.voice_note_audio = await persistVoiceNoteAudio(db, { actorEmail: actor.email, leadId: id, key, audio })
    const existing = await db.from('lead_activities')
      .select('id,lead_id,activity_type,description,agent,metadata,created_at').eq('id', activityId).maybeSingle()
    if (existing.error) throw new Error(existing.error.message)
    const inserted = existing.data ? null : await db.from('lead_activities').insert({ ...command.insert, id: activityId })
      .select('id,lead_id,activity_type,description,agent,metadata,created_at').single()
    if (inserted?.error && inserted.error.code !== '23505') throw new Error(inserted.error.message)
    const recovered = inserted?.error ? await db.from('lead_activities')
      .select('id,lead_id,activity_type,description,agent,metadata,created_at').eq('id', activityId).maybeSingle() : null
    const data = existing.data || inserted?.data || recovered?.data
    const error = recovered?.error
    if (error || !data) throw new Error(error?.message || 'Note insert returned no activity')
    if (data.lead_id !== id || data.activity_type !== 'note' || data.description !== command.insert.description
      || (data.metadata as Record<string, unknown> | null)?.actor_email !== actor.email
      || (data.metadata as Record<string, unknown> | null)?.idempotency_key !== key
      || JSON.stringify(voiceNoteAudioMetadata((data.metadata as Record<string, unknown> | null)?.voice_note_audio)) !== JSON.stringify(command.insert.metadata.voice_note_audio ?? null)) {
      throw new Error('Note identity conflict')
    }
    const result = { success: true, activity: data }
    try {
      await completeMobileCommand({ actorEmail: actor.email, idempotencyKey: key, token: reservation.token, status: 201, result })
    } catch (error) {
      console.error('[mobile/note] receipt completion failed:', error)
      return NextResponse.json({ ...result, warning: 'Note saved, but retry reconciliation is pending. Refresh before retrying.' }, { status: 201, headers: mobileNoStoreHeaders() })
    }
    return NextResponse.json(result, { status: 201, headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError || error instanceof MobileLeadAccessError || error instanceof MobileAttachmentError ? error.status : 503
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Note could not be saved.' }, { status, headers: mobileNoStoreHeaders() })
  }
}
