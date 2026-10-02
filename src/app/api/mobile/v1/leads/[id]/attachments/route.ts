import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import { DOCUMENTS_BUCKET } from '@/lib/documents'
import { MobileAttachmentError, validateMobileMessageFile } from '@/lib/mobile-api/message-attachments'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError, requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import { completeMobileCommand, mobileCommandIdentityUuid, reserveMobileCommand } from '@/lib/mobile-api/command-receipts'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { actor } = await requireAuthorizedMobileLead(req, id)
    const idempotencyKey = req.headers.get('idempotency-key')?.trim() || ''
    if (!id || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      return NextResponse.json({ error: 'Lead id and a stable Idempotency-Key are required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const db = supabaseAdmin()
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
    const documentId = mobileCommandIdentityUuid(actor.email, idempotencyKey, 'upload_message_attachment')
    const path = `lead/${id}/mobile/${documentId}-${filename.replace(/[^\w.\-]+/g, '_').slice(0, 120)}`
    const select = 'id,entity_type,entity_id,doc_type,filename,storage_path,mime_type,byte_size,uploaded_by,uploaded_at'
    const { data: initialRow, error: readError } = await db.from('documents').select(select).eq('id', documentId).maybeSingle()
    let row = initialRow
    if (readError) throw new MobileAttachmentError(readError.message, 503)
    const verifyStoredBytes = async () => {
      const { data: stored, error: downloadError } = await db.storage.from(DOCUMENTS_BUCKET).download(path)
      if (downloadError || !stored) throw new MobileAttachmentError('Attachment upload could not be reconciled.', 503)
      const storedBytes = new Uint8Array(await stored.arrayBuffer())
      if (createHash('sha256').update(storedBytes).digest('hex') !== createHash('sha256').update(bytes).digest('hex')) {
        throw new MobileAttachmentError('Attachment storage identity conflict.', 409)
      }
    }
    if (!row) {
      const { error: uploadError } = await db.storage.from(DOCUMENTS_BUCKET).upload(path, bytes, { contentType: mimeType, upsert: false })
      if (uploadError) {
        // The previous attempt may have uploaded the object before losing its response.
        await verifyStoredBytes()
      }
      const inserted = await db.from('documents').insert({
        id: documentId, entity_type: 'lead', entity_id: id, doc_type: 'message_attachment',
        filename, storage_path: path, mime_type: mimeType, byte_size: file.size,
        notes: 'Mobile message attachment', uploaded_by: actor.email,
      }).select(select).single()
      if (inserted.error && inserted.error.code !== '23505') throw new MobileAttachmentError('Attachment metadata could not be saved.', 503)
      if (inserted.error) {
        const reread = await db.from('documents').select(select).eq('id', documentId).maybeSingle()
        if (reread.error) throw new MobileAttachmentError(reread.error.message, 503)
        row = reread.data
      } else row = inserted.data
    }
    if (!row || row.entity_type !== 'lead' || row.entity_id !== id || row.doc_type !== 'message_attachment'
      || row.filename !== filename || row.storage_path !== path || row.mime_type !== mimeType
      || Number(row.byte_size) !== file.size || row.uploaded_by !== actor.email) {
      throw new MobileAttachmentError('Attachment identity conflict.', 409)
    }
    if (reservation.kind === 'recovered') await verifyStoredBytes()
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
      await completeMobileCommand({ actorEmail: actor.email, idempotencyKey, token: reservation.token, status: 201, result })
    } catch (receiptError) {
      console.error('[mobile/attachment] receipt completion failed:', receiptError)
      return NextResponse.json({
        ...result,
        warning: 'Attachment was uploaded, but retry reconciliation is pending. Keep this draft and do not upload it again.',
      }, { status: 201, headers: mobileNoStoreHeaders() })
    }
    return NextResponse.json(result, { status: 201, headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError || error instanceof MobileLeadAccessError || error instanceof MobileAttachmentError ? error.status : 503
    const message = error instanceof Error ? error.message : 'Attachment could not be uploaded.'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
