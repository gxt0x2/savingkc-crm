import { NextRequest, NextResponse } from 'next/server'

import {
  ANDON_ATTACHMENTS_BUCKET,
  MAX_ANDON_ATTACHMENTS,
  andonAttachmentKind,
  safeAndonAttachmentName,
  validateAndonAttachment,
} from '@/lib/andon-attachments'
import { requireAndonAttachmentOwner } from '@/lib/server/andon-attachment-access'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const parsed: unknown = await req.json()
    const body = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
    const filename = typeof body.filename === 'string' ? body.filename.trim() : ''
    const mimeType = typeof body.mime_type === 'string' ? body.mime_type.trim().toLowerCase() : ''
    const byteSize = typeof body.byte_size === 'number' ? body.byte_size : Number.NaN
    const storagePath = typeof body.storage_path === 'string' ? body.storage_path.trim() : ''
    const validationError = validateAndonAttachment({ name: filename, type: mimeType, size: byteSize })
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })
    if (!storagePath.startsWith(`feedback/${id}/`) || storagePath.includes('..')) {
      return NextResponse.json({ error: 'Invalid attachment path.' }, { status: 400 })
    }

    const access = await requireAndonAttachmentOwner(id)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const db = supabaseAdmin()
    const { data: existing } = await db
      .from('feedback_attachments')
      .select('id, feedback_id, filename, mime_type, byte_size, kind, created_at')
      .eq('storage_path', storagePath)
      .maybeSingle()
    if (existing?.feedback_id === id) return NextResponse.json({ attachment: existing })

    const { count: attachmentCount, error: countError } = await db
      .from('feedback_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('feedback_id', id)
    if (countError) {
      await db.storage.from(ANDON_ATTACHMENTS_BUCKET).remove([storagePath]).catch(() => {})
      const missingTable = countError.code === 'PGRST205' || /feedback_attachments|schema cache|could not find/i.test(countError.message ?? '')
      return NextResponse.json(
        { error: missingTable ? 'Andon attachment storage is not initialized. Apply the Andon attachments migration.' : 'The current attachment count could not be verified.' },
        { status: missingTable ? 503 : 500 },
      )
    }
    if ((attachmentCount ?? 0) >= MAX_ANDON_ATTACHMENTS) {
      await db.storage.from(ANDON_ATTACHMENTS_BUCKET).remove([storagePath]).catch(() => {})
      return NextResponse.json({ error: `An Andon can have up to ${MAX_ANDON_ATTACHMENTS} attachments.` }, { status: 409 })
    }

    const { data: storedObject, error: infoError } = await db.storage
      .from(ANDON_ATTACHMENTS_BUCKET)
      .info(storagePath)
    if (infoError || !storedObject) {
      return NextResponse.json({ error: 'The uploaded attachment could not be verified.' }, { status: 409 })
    }

    const storedSize = storedObject.size ?? storedObject.metadata?.size ?? byteSize
    const storedMimeType = storedObject.contentType || storedObject.metadata?.mimetype || mimeType
    const storedValidationError = validateAndonAttachment({ name: filename, type: storedMimeType, size: storedSize })
    if (storedValidationError) {
      await db.storage.from(ANDON_ATTACHMENTS_BUCKET).remove([storagePath]).catch(() => {})
      return NextResponse.json({ error: storedValidationError }, { status: 400 })
    }

    const { data: attachment, error: insertError } = await db
      .from('feedback_attachments')
      .insert({
        feedback_id: id,
        filename: safeAndonAttachmentName(filename),
        storage_path: storagePath,
        mime_type: storedMimeType || null,
        byte_size: storedSize,
        kind: andonAttachmentKind(storedMimeType, filename),
        uploaded_by: access.user.email,
      })
      .select('id, feedback_id, filename, mime_type, byte_size, kind, created_at')
      .single()

    if (insertError || !attachment) {
      await db.storage.from(ANDON_ATTACHMENTS_BUCKET).remove([storagePath]).catch(() => {})
      console.error('[Andon attachments] metadata insert failed:', insertError)
      const missingTable = insertError?.code === 'PGRST205' || /feedback_attachments|schema cache|could not find/i.test(insertError?.message ?? '')
      return NextResponse.json(
        { error: missingTable ? 'Andon attachment storage is not initialized. Apply the Andon attachments migration.' : 'The attachment metadata could not be saved.' },
        { status: missingTable ? 503 : 500 },
      )
    }

    return NextResponse.json({ attachment }, { status: 201 })
  } catch (error) {
    console.error('[Andon attachments] completion failed:', error)
    return NextResponse.json({ error: 'The attachment upload could not be completed.' }, { status: 500 })
  }
}
