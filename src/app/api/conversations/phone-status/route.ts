import { NextResponse } from 'next/server'
import { handleOptOut } from '@/lib/sms-opt-out'
import { supabase } from '@/lib/supabase-lazy'

type PhoneStatusAction = 'verified' | 'wrong_number' | 'dnc'

const ACTION_LABELS: Record<PhoneStatusAction, string> = {
  verified: 'verified',
  wrong_number: 'wrong number',
  dnc: 'DNC',
}

function cleanAction(value: unknown): PhoneStatusAction | null {
  if (value === 'verified' || value === 'wrong_number' || value === 'dnc') return value
  return null
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const leadId = typeof body?.leadId === 'string' && body.leadId.trim() ? body.leadId.trim() : null
    const phone = typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim() : ''
    const action = cleanAction(body?.action)
    const agent = typeof body?.agent === 'string' && body.agent.trim() ? body.agent.trim() : 'System'

    if (!phone || !action) {
      return NextResponse.json({ error: 'phone and action are required' }, { status: 400 })
    }

    if (action === 'dnc' || action === 'wrong_number') {
      await handleOptOut(phone, action === 'dnc' ? 'DNC' : 'WRONG_NUMBER')
    }

    const description = `Phone marked ${ACTION_LABELS[action]}${phone ? `: ${phone}` : ''}`
    const { error } = await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'status_change',
      description,
      agent,
      metadata: {
        source: 'dialer_conversation_hub',
        phone,
        phone_status: action,
        sms_suppressed: action === 'dnc' || action === 'wrong_number',
      },
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: action === 'verified'
        ? 'Phone marked verified.'
        : 'Phone suppressed for future SMS.',
    })
  } catch (err) {
    console.error('[conversations/phone-status] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 })
  }
}
