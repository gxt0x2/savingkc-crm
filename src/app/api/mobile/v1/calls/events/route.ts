import { NextRequest, NextResponse } from 'next/server'
import { requireMobileUser, mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
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
    const { user } = await requireMobileUser(req)
    const body = readBody(await req.json().catch(() => null))
    const leadId = typeof body.leadId === 'string' && body.leadId ? body.leadId : null
    const phone = cleanPhone(body.phone)
    const event = body.event === 'ended' ? 'ended' : body.event === 'started' ? 'started' : null

    if (!leadId || !phone || !event) {
      return NextResponse.json(
        { error: 'leadId, phone, and event are required' },
        { status: 400, headers: mobileNoStoreHeaders() },
      )
    }

    const duration = Math.max(0, Math.round(Number(body.durationSeconds || 0)))
    const outcome = body.outcome || (event === 'ended' ? 'unknown' : undefined)
    const description = event === 'started'
      ? `Mobile outbound call to ${phone}`
      : `Mobile outbound call ended: ${outcome || 'unknown'}`

    const db = supabaseAdmin()
    const { data, error } = await db
      .from('lead_activities')
      .insert({
        lead_id: leadId,
        activity_type: 'call',
        description,
        agent: user.email || 'Mobile',
        metadata: {
          source: 'savingkc_mobile',
          direction: 'outbound',
          phone,
          to: phone,
          event,
          status: event === 'started' ? 'initiated' : 'completed',
          outcome: outcome || null,
          disposition: body.disposition || null,
          duration,
          clientCallId: body.clientCallId || null,
          userId: user.id,
          userEmail: user.email || null,
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
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof MobileAuthError ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
