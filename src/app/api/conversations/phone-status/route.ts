import { NextResponse } from 'next/server'
import { handleOptOut } from '@/lib/sms-opt-out'
import { supabase } from '@/lib/supabase-lazy'

type PhoneStatusAction = 'verified' | 'wrong_number' | 'dnc' | 'spam' | 'blocked'

const ACTION_LABELS: Record<PhoneStatusAction, string> = {
  verified: 'verified',
  wrong_number: 'wrong number',
  dnc: 'DNC',
  spam: 'spam',
  blocked: 'blocked',
}

function cleanAction(value: unknown): PhoneStatusAction | null {
  if (value === 'verified' || value === 'wrong_number' || value === 'dnc' || value === 'spam' || value === 'blocked') return value
  return null
}

function suppressionReason(action: PhoneStatusAction): string | null {
  if (action === 'verified') return null
  if (action === 'wrong_number') return 'WRONG_NUMBER'
  if (action === 'dnc') return 'DNC'
  if (action === 'spam') return 'SPAM'
  return 'BLOCKED'
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const leadId = typeof body?.leadId === 'string' && body.leadId.trim() ? body.leadId.trim() : null
    const phone = typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim() : ''
    const action = cleanAction(body?.action)
    const agent = typeof body?.agent === 'string' && body.agent.trim() ? body.agent.trim() : 'System'
    const source = typeof body?.source === 'string' && body.source.trim() ? body.source.trim() : 'dialer_prospecting_hub'
    const prospectPhoneId = typeof body?.prospectPhoneId === 'string' && body.prospectPhoneId.trim() ? body.prospectPhoneId.trim() : null

    if (!phone || !action) {
      return NextResponse.json({ error: 'phone and action are required' }, { status: 400 })
    }

    const reason = suppressionReason(action)
    if (reason) {
      await handleOptOut(phone, reason)
    }

    const description = `Phone marked ${ACTION_LABELS[action]}${phone ? `: ${phone}` : ''}`
    const { error } = await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'status_change',
      description,
      agent,
      metadata: {
        source,
        phone,
        ...(prospectPhoneId ? { prospect_phone_id: prospectPhoneId } : {}),
        phone_status: action,
        sms_suppressed: Boolean(reason),
      },
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: action === 'verified'
        ? 'Phone marked verified.'
        : `Phone marked ${ACTION_LABELS[action]} and suppressed for future SMS.`,
    })
  } catch (err) {
    console.error('[conversations/phone-status] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 })
  }
}
