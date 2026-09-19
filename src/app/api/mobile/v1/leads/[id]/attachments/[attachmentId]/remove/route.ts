import { NextRequest, NextResponse } from 'next/server'

import { DOCUMENTS_BUCKET } from '@/lib/documents'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileActor } from '@/lib/mobile-api/auth'
import { completeMobileCommand, mobileCommandPayloadHash, reserveMobileCommand } from '@/lib/mobile-api/command-receipts'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const { actor } = await requireMobileActor(req)
    const { id, attachmentId } = await params
    const key = req.headers.get('idempotency-key')?.trim() || ''
    if (!id || !attachmentId || key.length < 8 || key.length > 200) {
      return NextResponse.json({ error: 'Lead, attachment, and a stable Idempotency-Key are required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const reservation = await reserveMobileCommand({
      actorEmail: actor.email,
      idempotencyKey: key,
      command: 'remove_message_attachment',
      leadId: id,
      payloadHash: mobileCommandPayloadHash({ leadId: id, attachmentId }),
    })
    if (reservation.kind === 'conflict') return NextResponse.json({ error: 'That Idempotency-Key belongs to a different attachment removal.' }, { status: 409, headers: mobileNoStoreHeaders() })
    if (reservation.kind === 'pending') return NextResponse.json({ error: 'This attachment removal is already processing.', code: 'operation_pending' }, { status: 409, headers: mobileNoStoreHeaders() })
    if (reservation.kind === 'replay') return NextResponse.json(reservation.result, { status: reservation.status, headers: mobileNoStoreHeaders() })

    const db = supabaseAdmin()
    const { data: row, error: readError } = await db.from('documents')
      .select('id,storage_path')
      .eq('id', attachmentId)
      .eq('entity_type', 'lead')
      .eq('entity_id', id)
      .eq('doc_type', 'message_attachment')
      .maybeSingle()
    if (readError) throw new Error(readError.message)
    let removed = false
    if (row) {
      const { error: storageError } = await db.storage.from(DOCUMENTS_BUCKET).remove([row.storage_path])
      if (storageError) throw new Error(storageError.message)
      const { error: deleteError } = await db.from('documents').delete().eq('id', row.id)
      if (deleteError) throw new Error(deleteError.message)
      removed = true
    }
    const result = { success: true, attachmentId, removed }
    try {
      await completeMobileCommand({ actorEmail: actor.email, idempotencyKey: key, status: 200, result })
    } catch (receiptError) {
      console.error('[mobile/attachment-remove] receipt completion failed:', receiptError)
      return NextResponse.json({
        ...result,
        warning: 'Attachment was removed, but retry reconciliation is pending. Refresh before retrying.',
      }, { headers: mobileNoStoreHeaders() })
    }
    return NextResponse.json(result, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 503
    const message = error instanceof Error ? error.message : 'Attachment could not be removed.'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
