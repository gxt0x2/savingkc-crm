import { NextRequest, NextResponse } from 'next/server'

import { externalSideEffectsDisabled } from '@/lib/preview-safety'
import { requireMobileActor, mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { resolveMobileEmailSender } from '@/lib/mobile-api/email-sender'
import { completeMobileCommand, mobileCommandPayloadHash, reserveMobileCommand } from '@/lib/mobile-api/command-receipts'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { sendLeadSms } from '@/lib/send-lead-sms'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

async function completedResponse(actorEmail: string, idempotencyKey: string, status: number, payload: Record<string, unknown>) {
  try {
    await completeMobileCommand({ actorEmail, idempotencyKey, status, result: payload })
    return NextResponse.json(payload, { status, headers: mobileNoStoreHeaders() })
  } catch (error) {
    console.error('[mobile-message] command receipt completion failed:', error)
    if (payload.sent === true) {
      return NextResponse.json({
        ...payload,
        persisted: false,
        deliveryState: 'delivered_receipt_unknown',
        warning: 'The provider accepted this message, but request reconciliation failed. Do not resend it.',
      }, { status: 200, headers: mobileNoStoreHeaders() })
    }
    throw error
  }
}

export async function POST(req: NextRequest) {
  try {
    const { actor } = await requireMobileActor(req)
    const idempotencyKey = req.headers.get('idempotency-key')?.trim() || ''
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      return NextResponse.json({ error: 'A stable Idempotency-Key is required' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
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

    const profile = resolveAgentTelephonyProfile(actor.email)
    const subject = input?.subject?.trim() || 'Message from SavingKC Homebuyers'
    const sender = channel === 'email' ? resolveMobileEmailSender(actor.email, actor.name) : null
    if (channel === 'sms' && !lead.phone) {
      return NextResponse.json({ error: 'This contact has no phone number' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    if (channel === 'email' && !lead.email) {
      return NextResponse.json({ error: 'This contact has no email address' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    if (channel === 'email' && externalSideEffectsDisabled()) {
      return NextResponse.json({ success: false, sent: false, persisted: false, deliveryState: 'disabled', error: 'Email delivery is disabled in this environment' }, { status: 503, headers: mobileNoStoreHeaders() })
    }
    if (channel === 'email' && !process.env.RESEND_API_KEY) {
      return NextResponse.json({ success: false, sent: false, persisted: false, deliveryState: 'not_configured', error: 'Email delivery is not configured' }, { status: 503, headers: mobileNoStoreHeaders() })
    }
    if (channel === 'email' && !sender) {
      return NextResponse.json({ success: false, sent: false, persisted: false, deliveryState: 'sender_not_authorized', error: 'No approved email sender is configured for this user' }, { status: 403, headers: mobileNoStoreHeaders() })
    }

    const payloadHash = mobileCommandPayloadHash({ leadId, channel, body, subject: channel === 'email' ? subject : null })
    const reservation = await reserveMobileCommand({
      actorEmail: actor.email,
      idempotencyKey,
      command: 'send_message',
      leadId,
      payloadHash,
    })
    if (reservation.kind === 'conflict') {
      return NextResponse.json({ error: 'That Idempotency-Key belongs to a different message' }, { status: 409, headers: mobileNoStoreHeaders() })
    }
    if (reservation.kind === 'pending') {
      return NextResponse.json({
        error: 'This message is already processing or its provider outcome is unknown. Do not resend it.',
        code: 'operation_pending', sent: null, persisted: false, deliveryState: 'delivery_unknown',
      }, { status: 409, headers: mobileNoStoreHeaders() })
    }
    if (reservation.kind === 'replay') {
      return NextResponse.json(reservation.result, { status: reservation.status, headers: mobileNoStoreHeaders() })
    }

    if (channel === 'sms') {
      const result = await sendLeadSms({
        leadId,
        phone: lead.phone,
        body,
        fromPhone: profile.defaultCallerId,
        agent: profile.displayName,
        source: 'mobile_app',
        metadata: { actor_email: actor.email, idempotency_key: idempotencyKey },
      })
      if (result.status === 'failed') return completedResponse(actor.email, idempotencyKey, result.deliveryState === 'delivery_unknown' ? 504 : 502, {
        error: result.error,
        sent: result.deliveryState === 'delivery_unknown' ? null : false,
        persisted: false,
        deliveryState: result.deliveryState || 'failed',
        ...(result.deliveryState === 'delivery_unknown' ? { code: 'delivery_unknown' } : {}),
      })
      if (result.status === 'skipped') {
        const error = result.reason === 'opted_out' ? 'This number has opted out of SMS messages' : 'Duplicate SMS sent within 24 hours'
        return completedResponse(actor.email, idempotencyKey, result.reason === 'opted_out' ? 400 : 409, { error, sent: false, persisted: false, deliveryState: result.reason })
      }
      return completedResponse(actor.email, idempotencyKey, 200, {
        success: true,
        channel,
        sent: true,
        persisted: result.persisted,
        deliveryState: result.deliveryState,
        warning: result.warning,
        sid: result.sid,
        from: result.from,
      })
    }

    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    let delivery: Awaited<ReturnType<typeof resend.emails.send>>
    try {
      delivery = await resend.emails.send(
        { from: sender!.from, to: [lead.email!], subject, text: body },
        { idempotencyKey },
      )
    } catch (error) {
      console.error('[mobile-message] email provider outcome unknown:', error)
      return completedResponse(actor.email, idempotencyKey, 504, {
        success: false,
        sent: null,
        persisted: false,
        code: 'delivery_unknown',
        deliveryState: 'delivery_unknown',
        error: 'Email provider connection ended after submission; delivery could not be confirmed. Do not resend this email.',
      })
    }
    if (delivery.error || !delivery.data?.id) {
      return completedResponse(actor.email, idempotencyKey, 502, {
        success: false,
        sent: false,
        persisted: false,
        deliveryState: 'provider_rejected',
        error: delivery.error?.message || 'Email provider did not accept the message',
      })
    }

    const { error: activityError } = await db.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'email',
      description: body,
      agent: actor.name,
      metadata: {
        direction: 'outbound', to: lead.email, subject, sent: true, source: 'mobile_app',
        actor_email: actor.email, provider: 'resend', provider_message_id: delivery.data.id,
        idempotency_key: idempotencyKey, sender: sender!.email,
      },
    })
    if (activityError) {
      return completedResponse(actor.email, idempotencyKey, 200, {
        success: true, channel, sent: true, persisted: false,
        deliveryState: 'delivered_not_persisted', id: delivery.data.id, from: sender!.email,
        warning: 'Email delivered, but CRM history could not be saved. Do not resend this email.',
      })
    }
    checkAutoAdvance(leadId, 'outbound_contact').catch((error) => console.error('[mobile-message] auto advance failed', error))
    return completedResponse(actor.email, idempotencyKey, 200, {
      success: true, channel, sent: true, persisted: true,
      deliveryState: 'delivered_and_persisted', id: delivery.data.id, from: sender!.email,
    })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof Error ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
