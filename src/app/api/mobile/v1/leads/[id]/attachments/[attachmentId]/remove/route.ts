import { NextRequest, NextResponse } from 'next/server'

import { DOCUMENTS_BUCKET } from '@/lib/documents'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError, requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import { mobileCommandPayloadHash, planMobileCommandEffect, reserveMobileCommand } from '@/lib/mobile-api/command-receipts'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const { id, attachmentId } = await params
    const { actor } = await requireAuthorizedMobileLead(req, id)
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
    const priorPlan = reservation.plan
    if (priorPlan && (priorPlan.attachmentId !== attachmentId
      || typeof priorPlan.storagePath !== 'string' && priorPlan.storagePath !== null)) {
      throw new Error('Attachment removal plan conflicts with the requested file')
    }
    const path = priorPlan ? priorPlan.storagePath as string | null : row?.storage_path || null
    if (row && path !== row.storage_path) throw new Error('Attachment path changed during retry')
    if (!priorPlan) {
      await planMobileCommandEffect({ actorEmail: actor.email, idempotencyKey: key,
        token: reservation.token, plan: { attachmentId, storagePath: path } })
    }
    // Only touch storage while the exact lead document still points at this path.
    if (row && path) {
      const { error: storageError } = await db.storage.from(DOCUMENTS_BUCKET).remove([path])
      if (storageError) throw new Error(storageError.message)
    }
    const { data: result, error: finishError } = await db.rpc('finish_mobile_attachment_removal_v1', {
      p_actor_email: actor.email, p_idempotency_key: key, p_lease_token: reservation.token,
    })
    if (finishError || !result || typeof result !== 'object') throw new Error(finishError?.message || 'Attachment removal could not be confirmed')
    return NextResponse.json(result, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError || error instanceof MobileLeadAccessError ? error.status : 503
    const message = error instanceof Error ? error.message : 'Attachment could not be removed.'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
