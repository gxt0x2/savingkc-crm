import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import { buildStoragePath, DOCUMENTS_BUCKET } from '@/lib/documents'
import { MobileAttachmentError, validateMobileMessageFile } from '@/lib/mobile-api/message-attachments'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileActor } from '@/lib/mobile-api/auth'
import { completeMobileCommand, reserveMobileCommand } from '@/lib/mobile-api/command-receipts'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireMobileActor(req)
    const { id } = await params
    const idempotencyKey = req.headers.get('idempotency-key')?.trim() || ''
    if (!id || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      return NextResponse.json({ error: 'Lead id and a stable Idempotency-Key are required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const db = supabaseAdmin()
    const { data: lead, error: leadError } = await db.from('leads').select('id').eq('id', id).maybeSingle()
    if (leadError) throw new MobileAttachmentError('The lead could not be verified.', 503)
    if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404, headers: mobileNoStoreHeaders() })
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new MobileAttachmentError('Choose a file to attach.', 400)
    const { filename, mimeType } = validateMobileMessageFile(file)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const payloadHash = createHash('sha256')
      .update(id)
      .update('\u0000')
      .update(filename)
      .update('\u0000')
      .update(mimeType)
      .update('\u0000')
      .update(bytes)
      .digest('hex')
    const reservation = await reserveMobileCommand({
      actorEmail: actor.email,
      idempotencyKey,
      command: 'upload_message_attachment',
      leadId: id,
      payloadHash,
    })
    if (reservation.kind === 'conflict') return NextResponse.json({ error: 'That Idempotency-Key belongs to a different attachment.' }, { status: 409, headers: mobileNoStoreHeaders() })
    if (reservation.kind === 'pending') return NextResponse.json({ error: 'This attachment upload is already processing. Refresh before retrying.', code: 'operation_pending' }, { status: 409, headers: mobileNoStoreHeaders() })
    if (reservation.kind === 'replay') return NextResponse.json(reservation.result, { status: reservation.status, headers: mobileNoStoreHeaders() })
    const path = buildStoragePath('lead', id, filename)
    const { error: uploadError } = await db.storage.from(DOCUMENTS_BUCKET).upload(path, bytes, { contentType: mimeType, upsert: false })
    if (uploadError) throw new MobileAttachmentError('Attachment upload failed.', 503)
    const { data: row, error: insertError } = await db.from('documents').insert({
      entity_type: 'lead',
      entity_id: id,
      doc_type: 'message_attachment',
      filename,
      storage_path: path,
      mime_type: mimeType,
      byte_size: file.size,
      notes: 'Mobile message attachment',
      uploaded_by: actor.email,
    }).select('id,filename,mime_type,byte_size,uploaded_at').single()
    if (insertError || !row) {
      await db.storage.from(DOCUMENTS_BUCKET).remove([path]).catch(() => undefined)
      throw new MobileAttachmentError('Attachment metadata could not be saved.', 503)
    }
    const result = {
      success: true,
      attachment: {
        id: row.id,
        filename: row.filename,
        mimeType: row.mime_type,
        byteSize: row.byte_size,
        uploadedAt: row.uploaded_at,
      },
    }
    try {
      await completeMobileCommand({ actorEmail: actor.email, idempotencyKey, status: 201, result })
    } catch (receiptError) {
      console.error('[mobile/attachment] receipt completion failed:', receiptError)
      return NextResponse.json({
        ...result,
        warning: 'Attachment was uploaded, but retry reconciliation is pending. Keep this draft and do not upload it again.',
      }, { status: 201, headers: mobileNoStoreHeaders() })
    }
    return NextResponse.json(result, { status: 201, headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError || error instanceof MobileAttachmentError ? error.status : 503
    const message = error instanceof Error ? error.message : 'Attachment could not be uploaded.'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
