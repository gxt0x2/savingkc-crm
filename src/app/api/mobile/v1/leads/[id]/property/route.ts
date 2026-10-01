import { NextRequest, NextResponse } from 'next/server'

import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError, requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import { completeMobileCommand, mobileCommandPayloadHash, reserveMobileCommand } from '@/lib/mobile-api/command-receipts'
import { MobilePropertyError, parseMobilePropertyPatch, updateMobilePropertyDetails } from '@/lib/server/mobile-property-details'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { actor } = await requireAuthorizedMobileLead(req, id)
    if (!id) return NextResponse.json({ error: 'Lead id is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    const idempotencyKey = req.headers.get('idempotency-key')?.trim() || ''
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      return NextResponse.json({ error: 'A stable Idempotency-Key is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const patch = parseMobilePropertyPatch(await req.json().catch(() => null))
    const reservation = await reserveMobileCommand({
      actorEmail: actor.email,
      idempotencyKey,
      command: 'update_property_details',
      leadId: id,
      payloadHash: mobileCommandPayloadHash({ leadId: id, ...patch }),
    })
    if (reservation.kind === 'conflict') {
      return NextResponse.json({ error: 'That Idempotency-Key belongs to different property changes.' }, { status: 409, headers: mobileNoStoreHeaders() })
    }
    if (reservation.kind === 'pending') {
      return NextResponse.json({ error: 'These property changes are already processing. Refresh before retrying.', code: 'operation_pending' }, { status: 409, headers: mobileNoStoreHeaders() })
    }
    if (reservation.kind === 'replay') {
      return NextResponse.json(reservation.result, { status: reservation.status, headers: mobileNoStoreHeaders() })
    }

    let update
    try {
      update = await updateMobilePropertyDetails({ leadId: id, actor: { email: actor.email, name: actor.fullName }, patch })
    } catch (error) {
      if (error instanceof MobilePropertyError && error.status === 409) {
        const result = { error: error.message }
        await completeMobileCommand({ actorEmail: actor.email, idempotencyKey, status: 409, result })
        return NextResponse.json(result, { status: 409, headers: mobileNoStoreHeaders() })
      }
      throw error
    }
    const result = { success: true, ...update }
    try {
      await completeMobileCommand({ actorEmail: actor.email, idempotencyKey, status: 200, result })
    } catch (receiptError) {
      console.error('[mobile/property] receipt completion failed:', receiptError)
      return NextResponse.json({
        ...result,
        warning: 'Property facts were saved, but retry reconciliation is pending. Refresh before retrying.',
      }, { headers: mobileNoStoreHeaders() })
    }
    return NextResponse.json(result, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError || error instanceof MobileLeadAccessError || error instanceof MobilePropertyError ? error.status : 503
    const message = error instanceof Error ? error.message : 'Property facts could not be saved.'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
