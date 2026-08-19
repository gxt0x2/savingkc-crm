import { NextRequest, NextResponse } from 'next/server'

import { externalSideEffectsDisabled } from '@/lib/preview-safety'
import { requireMobileUser, mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { onCommunicationEvent } from '@/lib/manifest-sync'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { sendLeadSms } from '@/lib/send-lead-sms'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireMobileUser(req)
    const input = await req.json().catch(() => null) as { leadId?: string; channel?: 'sms' | 'email'; body?: string; subject?: string } | null
    const leadId = input?.leadId?.trim()
    const body = input?.body?.trim()
    const channel = input?.channel
    if (!leadId || !body || (channel !== 'sms' && channel !== 'email')) {
      return NextResponse.json({ error: 'leadId, channel, and body are required' }, { status: 400, headers: mobileNoStoreHeaders() })
    }

    const db = supabaseAdmin()
    const { data: lead, error: leadError } = await db.from('leads').select('id, phone, email').eq('id', leadId).maybeSingle()
    if (leadError) throw new Error(leadError.message)
    if (!lead) return NextResponse.json({ error: 'Contact not found' }, { status: 404, headers: mobileNoStoreHeaders() })

    const profile = resolveAgentTelephonyProfile(user.email)
    if (channel === 'sms') {
      if (!lead.phone) return NextResponse.json({ error: 'This contact has no phone number' }, { status: 400, headers: mobileNoStoreHeaders() })
      const result = await sendLeadSms({
        leadId,
        phone: lead.phone,
        body,
        fromPhone: profile.defaultCallerId,
        agent: profile.displayName,
        source: 'mobile_app',
      })
      if (result.status === 'failed') return NextResponse.json({ error: result.error }, { status: 502, headers: mobileNoStoreHeaders() })
      if (result.status === 'skipped') {
        const error = result.reason === 'opted_out' ? 'This number has opted out of SMS messages' : 'Duplicate SMS sent within 24 hours'
        return NextResponse.json({ error }, { status: result.reason === 'opted_out' ? 400 : 409, headers: mobileNoStoreHeaders() })
      }
      return NextResponse.json({
        success: true,
        channel,
        sent: true,
        persisted: result.persisted,
        deliveryState: result.deliveryState,
        warning: result.warning,
        sid: result.sid,
        from: result.from,
      }, { headers: mobileNoStoreHeaders() })
    }

    if (!lead.email) return NextResponse.json({ error: 'This contact has no email address' }, { status: 400, headers: mobileNoStoreHeaders() })
    const subject = input?.subject?.trim() || 'Message from SavingKC Homebuyers'
    let sent = false
    if (!externalSideEffectsDisabled() && process.env.RESEND_API_KEY) {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const fromEmail = process.env.RESEND_FROM_EMAIL || 'ernest@savingkc.com'
      await resend.emails.send({ from: `SavingKC Homebuyers <${fromEmail}>`, to: [lead.email], subject, text: body })
      sent = true
    }

    const { error: activityError } = await db.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'email',
      description: body,
      agent: profile.displayName,
      metadata: { direction: 'outbound', to: lead.email, subject, sent, source: 'mobile_app' },
    })
    if (activityError) throw new Error(activityError.message)
    checkAutoAdvance(leadId, 'outbound_contact').catch((error) => console.error('[mobile-message] auto advance failed', error))
    onCommunicationEvent(leadId, { type: 'email', content: body }).catch((error) => console.error('[mobile-message] manifest sync failed', error))
    return NextResponse.json({ success: true, channel, sent }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof Error ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
