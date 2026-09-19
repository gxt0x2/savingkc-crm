import { formatPhone } from '@/lib/format'
import { NextRequest, NextResponse } from 'next/server'
import { requireMobileActor, mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { completeMobileCommand, mobileCommandPayloadHash, reserveMobileCommand } from '@/lib/mobile-api/command-receipts'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

type CallEventBody = {
  leadId?: string
  phone?: string
  event?: 'started' | 'ended'
  durationSeconds?: number
  outcome?: 'answered' | 'connected' | 'no_answer' | 'missed' | 'voicemail' | 'bad_number' | 'busy' | 'unknown'
  disposition?: string
  note?: string
  clientCallId?: string
}

function readBody(value: unknown): CallEventBody {
  return value && typeof value === 'object' ? (value as CallEventBody) : {}
}

function cleanPhone(phone: unknown): string | null {
  return typeof phone === 'string' && phone.trim()
    ? phone.replace(/[^\d+]/g, '')
    : null
}

export async function POST(req: NextRequest) {
  try {
    const { actor } = await requireMobileActor(req)
    const idempotencyKey = req.headers.get('idempotency-key')?.trim() || ''
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      return NextResponse.json({ error: 'A stable Idempotency-Key is required' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const body = readBody(await req.json().catch(() => null))
    const leadId = typeof body.leadId === 'string' && body.leadId ? body.leadId : null
    const phone = cleanPhone(body.phone)
    const event = body.event === 'ended' ? 'ended' : body.event === 'started' ? 'started' : null

    if (!phone || event !== 'ended') {
      return NextResponse.json(
        { error: 'phone and an ended event are required' },
        { status: 400, headers: mobileNoStoreHeaders() },
      )
    }

    const duration = Math.max(0, Math.round(Number(body.durationSeconds || 0)))
    const outcome = body.outcome || 'unknown'
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 10_000) : ''
    const description = note || `Mobile outbound call ended: ${outcome} · ${formatPhone(phone)}`
    const payloadHash = mobileCommandPayloadHash({ leadId, phone, event, duration, outcome, disposition: body.disposition || null, note })
    const reservation = await reserveMobileCommand({
      actorEmail: actor.email, idempotencyKey, command: 'log_call_outcome', leadId: leadId ?? 'unknown', payloadHash,
    })
    if (reservation.kind === 'conflict') return NextResponse.json({ error: 'That Idempotency-Key belongs to a different call outcome' }, { status: 409, headers: mobileNoStoreHeaders() })
    if (reservation.kind === 'pending') return NextResponse.json({ error: 'This call outcome is already processing. Refresh before retrying.', code: 'operation_pending' }, { status: 409, headers: mobileNoStoreHeaders() })
    if (reservation.kind === 'replay') return NextResponse.json(reservation.result, { status: reservation.status, headers: mobileNoStoreHeaders() })

    const db = supabaseAdmin()
    const { data, error } = await db
      .from('lead_activities')
      .insert({
        lead_id: leadId,
        activity_type: 'call',
        description,
        agent: actor.name,
        metadata: {
          source: 'savingkc_mobile',
          direction: 'outbound',
          phone,
          to: phone,
          event,
          status: 'completed',
          outcome,
          disposition: body.disposition || null,
          duration,
          clientCallId: body.clientCallId || null,
          notes: note || null,
          actor_email: actor.email,
          idempotency_key: idempotencyKey,
        },
      })
      .select('id')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: mobileNoStoreHeaders() })
    }

    if (leadId) {
      await db.from('leads').update({ updated_at: new Date().toISOString() }).eq('id', leadId)
    }

    const result = { ok: true, activityId: data?.id ?? null }
    try {
      await completeMobileCommand({ actorEmail: actor.email, idempotencyKey, status: 200, result })
    } catch (receiptError) {
      console.error('[mobile/call-event] receipt completion failed:', receiptError)
      return NextResponse.json({ ...result, warning: 'Call saved, but retry reconciliation is pending. Refresh before retrying.' }, { headers: mobileNoStoreHeaders() })
    }
    return NextResponse.json(result, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof MobileAuthError ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
