import { NextRequest, NextResponse } from 'next/server'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError, requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import { completeMobileCommand, mobileCommandPayloadHash, reserveMobileCommand } from '@/lib/mobile-api/command-receipts'
import { getCanonicalLeadBriefingState, queueCanonicalLeadBriefing } from '@/lib/server/canonical-lead-briefing'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function OPTIONS() { return mobileOptionsResponse() }

function failure(error: unknown) {
  const known = error instanceof MobileAuthError || error instanceof MobileLeadAccessError
  const status = known ? error.status : 503
  const message = known ? error.message : 'Lead briefing service is temporarily unavailable.'
  if (!known) console.error('[mobile/briefing] request failed', error)
  return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: 'A valid lead id is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    await requireAuthorizedMobileLead(req, id)
    return NextResponse.json(await getCanonicalLeadBriefingState(id), { headers: mobileNoStoreHeaders() })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: 'A valid lead id is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    const { actor } = await requireAuthorizedMobileLead(req, id)
    const idempotencyKey = req.headers.get('idempotency-key')?.trim() || ''
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      return NextResponse.json({ error: 'A stable Idempotency-Key is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const reservation = await reserveMobileCommand({
      actorEmail: actor.email,
      idempotencyKey,
      command: 'refresh_lead_briefing',
      leadId: id,
      payloadHash: mobileCommandPayloadHash({ leadId: id }),
    })
    if (reservation.kind === 'conflict') return NextResponse.json({ error: 'That Idempotency-Key belongs to a different briefing refresh.' }, { status: 409, headers: mobileNoStoreHeaders() })
    if (reservation.kind === 'pending') return NextResponse.json({ error: 'This briefing refresh is already processing. Refresh the lead before retrying.', code: 'operation_pending' }, { status: 409, headers: mobileNoStoreHeaders() })
    if (reservation.kind === 'replay') return NextResponse.json(reservation.result, { status: reservation.status, headers: mobileNoStoreHeaders() })

    const revision = await queueCanonicalLeadBriefing({
      leadId: id,
      reason: 'mobile_manual_refresh',
      requestedBy: actor.email,
      delaySeconds: 0,
    })
    const result = { queued: true, leadId: id, revision, status: 'pending' }
    try {
      await completeMobileCommand({ actorEmail: actor.email, idempotencyKey, status: 202, result })
    } catch (receiptError) {
      console.error('[mobile/briefing] receipt completion failed', receiptError)
      return NextResponse.json({ ...result, warning: 'Briefing refresh was queued, but retry reconciliation is pending. Refresh the lead before retrying.' }, { status: 202, headers: mobileNoStoreHeaders() })
    }
    return NextResponse.json(result, { status: 202, headers: mobileNoStoreHeaders() })
  } catch (error) {
    return failure(error)
  }
}
