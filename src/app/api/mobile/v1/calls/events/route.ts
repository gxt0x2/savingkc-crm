import { formatPhone } from '@/lib/format'
import { NextRequest, NextResponse } from 'next/server'
import { normalizeDisposition } from '@/lib/dialer-dispositions'
import { mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse, requireMobileUser } from '@/lib/mobile-api/auth'
import {
  MobileLeadAccessError,
  requireAuthorizedMobileLead,
  resolveMobileScopedActor,
} from '@/lib/mobile-api/authorized-lead'
import {
  boundedCallNote,
  boundedCallToken,
  boundedClientCallId,
  persistUnassignedMobileCall,
  PhoneCallRecordError,
  requireE164Phone,
  suppressPhoneForVoiceDnc,
} from '@/lib/mobile-api/phone-call-record'
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
  outcome?: 'connected' | 'missed' | 'voicemail' | 'bad_number' | 'busy' | 'unknown'
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

function isVoiceDnc(disposition: string | null): boolean {
  return normalizeDisposition(disposition) === 'dnc'
}

export async function POST(req: NextRequest) {
  try {
    const body = readBody(await req.json().catch(() => null))
    const leadId = typeof body.leadId === 'string' && body.leadId ? body.leadId : null
    const phone = cleanPhone(body.phone)
    const event = body.event === 'ended' ? 'ended' : body.event === 'started' ? 'started' : null

    if (!phone || !event) {
      return NextResponse.json(
        { error: 'phone and event are required' },
        { status: 400, headers: mobileNoStoreHeaders() },
      )
    }

    const outcome = boundedCallToken(body.outcome) || (event === 'ended' ? 'unknown' : null)
    const disposition = boundedCallToken(body.disposition)
    const note = boundedCallNote(body.note)
    const clientCallId = boundedClientCallId(body.clientCallId)
    const parsedDuration = Number(body.durationSeconds)
    const duration = Number.isFinite(parsedDuration)
      ? Math.min(86_400, Math.max(0, Math.round(parsedDuration)))
      : 0
    const dnc = isVoiceDnc(disposition)

    // An ad-hoc dial has no lead. Save it for this agent only. Do not invent
    // a lead, prospect, or seller, and do not attach the call to whoever
    // happens to share the number.
    if (!leadId) {
      const { user } = await requireMobileUser(req)
      const email = user.email?.trim().toLowerCase()
      if (!email) throw new MobileAuthError('Authenticated user has no email')
      const actor = await resolveMobileScopedActor(email)
      const agentName = actor?.fullName?.trim()
      if (!actor || !agentName) throw new MobileLeadAccessError('CRM profile not authorized', 403)
      const userId = typeof user.id === 'string' ? user.id.trim() : ''
      if (!userId) throw new MobileAuthError('Authenticated user identity unavailable')
      const e164 = requireE164Phone(phone)
      if (dnc) await suppressPhoneForVoiceDnc(e164)
      const saved = await persistUnassignedMobileCall(supabaseAdmin(), {
        phone: e164,
        event,
        durationSeconds: duration,
        outcome,
        disposition,
        note,
        clientCallId,
        userId,
        userEmail: email,
        agentName,
      })
      return NextResponse.json({
        ok: true,
        activityId: saved.id,
        skipped: false,
      }, { headers: mobileNoStoreHeaders() })
    }

    // Never let a bearer token attach a call to someone else's lead.
    const { actor, user } = await requireAuthorizedMobileLead(req, leadId)
    if (dnc) await suppressPhoneForVoiceDnc(requireE164Phone(phone))

    const description = event === 'started'
      ? `Mobile outbound call to ${formatPhone(phone)}`
      : `Mobile outbound call ended: ${outcome || 'unknown'}`

    const db = supabaseAdmin()
    const { data, error } = await db
      .from('lead_activities')
      .insert({
        lead_id: leadId,
        activity_type: 'call',
        description,
        agent: actor.fullName,
        metadata: {
          source: 'savingkc_mobile',
          direction: 'outbound',
          phone,
          to: phone,
          event,
          status: event === 'started' ? 'initiated' : 'completed',
          outcome: outcome || null,
          disposition: disposition || null,
          duration,
          clientCallId: clientCallId || null,
          userId: user.id,
          userEmail: user.email || null,
          ...(note ? { notes: note } : {}),
        },
      })
      .select('id')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: mobileNoStoreHeaders() })
    }

    await db.from('leads').update({ updated_at: new Date().toISOString() }).eq('id', leadId)

    return NextResponse.json({ ok: true, activityId: data?.id ?? null }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const known = error instanceof MobileAuthError || error instanceof MobileLeadAccessError || error instanceof PhoneCallRecordError
    const status = known ? error.status : 500
    const message = known ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
