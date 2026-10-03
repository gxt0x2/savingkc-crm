import { NextRequest, NextResponse } from 'next/server'

import { externalSideEffectsDisabled } from '@/lib/preview-safety'
import { mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError, requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import {
  claimMobileMessageSend,
  hashMobileMessageKey,
  mobileMessagePayloadHash,
  mobileMessageProviderKey,
  transitionMobileMessageSend,
} from '@/lib/mobile-api/message-send-receipts'
import { sendLeadSms } from '@/lib/send-lead-sms'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type StoredLead = { id: string; phone: string | null; email: string | null }
type ReceiptResult = Record<string, unknown>
const SMS_CONVERSATION_TEMPLATE_ID = 'sms.conversation.1to1.v1'

function json(result: ReceiptResult, status = 200) {
  return NextResponse.json(result, { status, headers: mobileNoStoreHeaders() })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function replayResponse(status: number, result: ReceiptResult) {
  return json(result, status)
}

export function OPTIONS() {
  return mobileOptionsResponse()
}

export async function POST(req: NextRequest) {
  try {
    const key = req.headers.get('Idempotency-Key')?.trim() || ''
    if (!/^[\x21-\x7e]{8,200}$/.test(key)) {
      return json({ error: 'A valid Idempotency-Key header (8–200 visible ASCII characters) is required.' }, 400)
    }

    const parsed = await req.json().catch(() => null) as unknown
    if (!isObject(parsed)) return json({ error: 'A JSON message command is required.' }, 400)
    const unsupportedFields = Object.keys(parsed).filter((field) => !['leadId', 'channel', 'body', 'subject', 'to', 'messageKind', 'attachmentIds', 'template_id', 'reconcileOnly'].includes(field))
    if (unsupportedFields.length) {
      return json({ error: 'Attachments, voice notes, and other unsupported message fields cannot be sent by this endpoint.' }, 400)
    }
    if ((parsed.messageKind !== undefined && parsed.messageKind !== 'text')
      || (parsed.attachmentIds !== undefined && (!Array.isArray(parsed.attachmentIds) || parsed.attachmentIds.length > 0))) {
      return json({ error: 'Voice notes and attachments are not supported by this endpoint.' }, 400)
    }
    const leadId = typeof parsed.leadId === 'string' ? parsed.leadId.trim() : ''
    const body = typeof parsed.body === 'string' ? parsed.body.trim() : ''
    const channel = parsed.channel
    if (!leadId || !body || (channel !== 'sms' && channel !== 'email')) {
      return json({ error: 'leadId, channel, and body are required' }, 400)
    }
    // This identifies the mobile client's human one-to-one command. It never
    // grants consent or sender approval; sendLeadSms still enforces those gates.
    if (parsed.template_id !== undefined
      && (channel !== 'sms' || parsed.template_id !== SMS_CONVERSATION_TEMPLATE_ID)) {
      return json({ error: 'Only the supported one-to-one SMS conversation template may be used.' }, 400)
    }
    const templateMetadata = parsed.template_id === SMS_CONVERSATION_TEMPLATE_ID
      ? { template_id: SMS_CONVERSATION_TEMPLATE_ID }
      : {}
    if (parsed.reconcileOnly !== undefined && typeof parsed.reconcileOnly !== 'boolean') {
      return json({ error: 'reconcileOnly must be a boolean.' }, 400)
    }
    const { actor, user } = await requireAuthorizedMobileLead(req, leadId)
    if (!user.id) return json({ error: 'Authenticated user identity is unavailable.' }, 401)

    const db = supabaseAdmin()
    const { data: leadData, error: leadError } = await db.from('leads').select('id, phone, email').eq('id', leadId).maybeSingle()
    if (leadError) throw new Error(leadError.message)
    if (!leadData) return json({ error: 'Contact not found' }, 404)
    const lead = leadData as StoredLead
    if (channel === 'sms' && !lead.phone) return json({ error: 'This contact has no phone number' }, 400)
    if (channel === 'email' && !lead.email) return json({ error: 'This contact has no email address' }, 400)
    if (parsed.to !== undefined && (channel !== 'email' || typeof parsed.to !== 'string'
      || parsed.to.trim().toLowerCase() !== lead.email?.trim().toLowerCase())) {
      return json({ error: 'The recipient must match the authorized contact email.' }, 400)
    }

    const subject = channel === 'email'
      ? (typeof parsed.subject === 'string' && parsed.subject.trim() ? parsed.subject.trim() : 'Message from SavingKC Homebuyers')
      : null
    const destination = channel === 'email' ? lead.email!.trim() : lead.phone!.trim()
    const payloadHash = mobileMessagePayloadHash({ leadId, channel, to: destination, subject, body, ...templateMetadata })
    const keyHash = hashMobileMessageKey(key)
    const providerKey = mobileMessageProviderKey(user.id, key)
    const claim = await claimMobileMessageSend({
      userId: user.id,
      keyHash,
      leadId,
      channel,
      payloadHash,
      providerKey,
    })
    if (claim.kind === 'conflict') return json({ error: 'This Idempotency-Key was already used for a different message.' }, 409)
    if (claim.kind === 'pending') return json({ error: 'This message command is already being processed.' }, 409)
    if (claim.kind === 'replay') return replayResponse(claim.status, claim.result)
    if (parsed.reconcileOnly === true && claim.state !== 'provider_accepted'
      && !(channel === 'sms' && claim.state === 'sending')) {
      // A missing/reserved receipt or incomplete email acceptance is never a
      // reason to submit to a provider from the client's history-repair action.
      return json({ error: 'CRM history cannot be repaired until provider acceptance is confirmed. This action did not send a message.' }, 409)
    }

    const profile = resolveAgentTelephonyProfile(actor.email)
    const receiptMeta = { mobile_message_command_id: claim.receiptId, ...templateMetadata }
    const persistActivity = async (providerId: string | null, sent: boolean, from?: string) => {
      // An accepted activity may have been written before the receipt completion
      // failed. Reconcile it by immutable receipt ID before attempting an insert.
      const existing = await db.from('lead_activities').select('id')
        .eq('lead_id', leadId).eq('metadata->>mobile_message_command_id', claim.receiptId).maybeSingle()
      if (existing.error) throw new Error(existing.error.message)
      if (existing.data) return
      const metadata: Record<string, unknown> = {
        direction: 'outbound',
        to: destination,
        sent,
        source: 'mobile_app',
        ...receiptMeta,
      }
      if (channel === 'email') metadata.subject = subject
      if (channel === 'sms') {
        if (providerId) metadata.message_sid = providerId
        if (from) metadata.from = from
      }
      const { error } = await db.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: channel,
        description: body,
        agent: actor.fullName,
        metadata,
      })
      if (error?.code === '23505') {
        const stored = await db.from('lead_activities').select('id')
          .eq('lead_id', leadId).eq('metadata->>mobile_message_command_id', claim.receiptId).maybeSingle()
        if (!stored.error && stored.data) return
      }
      if (error) throw new Error(error.message)
    }

    const complete = async (status: number, result: ReceiptResult, providerId?: string | null) => {
      await transitionMobileMessageSend({
        userId: user.id,
        keyHash,
        token: claim.token,
        from: 'provider_accepted',
        to: 'completed',
        providerId,
        status,
        result,
      })
      return json(result, status)
    }

    if (claim.state === 'sending' && channel === 'sms') {
      // Twilio has no idempotency-key support in this integration. After a
      // worker crash, reconcile a canonical activity if it was already stored;
      // otherwise leave an honest unknown outcome and never call Twilio twice.
      const priorActivity = await db.from('lead_activities').select('id,metadata')
        .eq('lead_id', leadId).eq('metadata->>mobile_message_command_id', claim.receiptId).maybeSingle()
      if (priorActivity.error) {
        return json({ error: 'SMS delivery is being reconciled. Retry this same command; do not create a new send.' }, 503)
      }
      const metadata = isObject(priorActivity.data?.metadata) ? priorActivity.data.metadata : {}
      const sid = typeof metadata.message_sid === 'string' ? metadata.message_sid : null
      if (!priorActivity.data || !sid) {
        const result = { error: 'SMS delivery outcome is unknown. Do not resend this command.' }
        await transitionMobileMessageSend({ userId: user.id, keyHash, token: claim.token, from: 'sending', to: 'uncertain', status: 409, result })
        return json(result, 409)
      }
      const accepted = {
        success: true,
        channel,
        sent: true,
        persisted: true,
        deliveryState: 'provider_accepted_and_persisted',
        sid,
        ...(typeof metadata.from === 'string' ? { from: metadata.from } : {}),
      }
      await transitionMobileMessageSend({ userId: user.id, keyHash, token: claim.token, from: 'sending', to: 'provider_accepted', providerId: sid, status: 202, result: accepted })
      return complete(200, accepted, sid)
    }

    if (claim.state === 'provider_accepted') {
      const accepted = claim.result || {}
      const sent = accepted.sent === true
      const providerId = claim.providerId
      if (sent && !providerId) {
        return json({ success: true, channel, sent: true, persisted: false, deliveryState: 'delivery_unknown', warning: 'The provider accepted the send, but its receipt is incomplete. Do not resend.' }, 202)
      }
      try {
        await persistActivity(providerId, sent, typeof accepted.from === 'string' ? accepted.from : undefined)
      } catch (error) {
        console.error('[mobile-message] accepted send history recovery failed', error)
        return json({ success: true, channel, sent, persisted: false, deliveryState: 'delivered_not_persisted', warning: 'The message was accepted, but CRM history could not be saved. Retry this same command to repair history; do not create a new send.' }, 202)
      }
      return complete(200, { success: true, channel, sent, persisted: true, deliveryState: 'provider_accepted_and_persisted', ...(providerId ? { providerId } : {}), ...(typeof accepted.from === 'string' ? { from: accepted.from } : {}) }, providerId)
    }

    if (claim.state === 'reserved') {
      if (externalSideEffectsDisabled()) {
        const result = { success: true, channel, sent: false, persisted: true, deliveryState: 'not_sent_preview' }
        try {
          await persistActivity(null, false)
        } catch (error) {
          console.error('[mobile-message] preview activity persistence failed', error)
          return json({ ...result, persisted: false }, 503)
        }
        await transitionMobileMessageSend({ userId: user.id, keyHash, token: claim.token, from: 'reserved', to: 'failed', status: 200, result })
        return json(result)
      }
      if (channel === 'email' && !process.env.RESEND_API_KEY) {
        const result = { error: 'Email sending is not configured.', sent: false }
        await transitionMobileMessageSend({ userId: user.id, keyHash, token: claim.token, from: 'reserved', to: 'failed', status: 503, result })
        return json(result, 503)
      }
      await transitionMobileMessageSend({ userId: user.id, keyHash, token: claim.token, from: 'reserved', to: 'sending', status: 0, result: { sent: false } })
    }

    if (channel === 'email') {
      let sendResult: { data?: { id?: string } | null; error?: { message?: string; name?: string; statusCode?: number | null } | null }
      try {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY!)
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'ernest@savingkc.com'
        sendResult = await resend.emails.send({
          from: `SavingKC Homebuyers <${fromEmail}>`,
          to: [destination],
          subject: subject!,
          text: body,
        }, { idempotencyKey: claim.providerKey })
      } catch (error) {
        console.error('[mobile-message] Resend outcome uncertain; preserve same-key retry', error)
        return json({ error: 'Email delivery outcome is being reconciled. Retry with the same Idempotency-Key.' }, 503)
      }
      if (sendResult.error || !sendResult.data?.id) {
        const code = sendResult.error?.name || ''
        const statusCode = sendResult.error?.statusCode
        if (statusCode === null || statusCode === undefined || statusCode >= 500 || code === 'concurrent_idempotent_requests') {
          return json({ error: 'Email delivery outcome is being reconciled. Retry with the same Idempotency-Key.' }, 503)
        }
        const result = { error: 'Email provider rejected the message.', sent: false }
        await transitionMobileMessageSend({ userId: user.id, keyHash, token: claim.token, from: 'sending', to: 'failed', status: 502, result })
        return json(result, 502)
      }
      const providerId = sendResult.data.id
      const accepted = { success: true, channel, sent: true, persisted: false, deliveryState: 'provider_accepted_history_pending', providerId }
      await transitionMobileMessageSend({ userId: user.id, keyHash, token: claim.token, from: 'sending', to: 'provider_accepted', providerId, status: 202, result: accepted })
      try {
        await persistActivity(providerId, true)
      } catch (error) {
        console.error('[mobile-message] email accepted but history persistence failed', error)
        return json({ ...accepted, warning: 'Email was accepted, but CRM history could not be saved. Retry this same command to repair history; do not create a new send.' }, 202)
      }
      return complete(200, { success: true, channel, sent: true, persisted: true, deliveryState: 'provider_accepted_and_persisted', providerId }, providerId)
    }

    let result: Awaited<ReturnType<typeof sendLeadSms>>
    try {
      result = await sendLeadSms({
        leadId,
        phone: destination,
        body,
        fromPhone: profile.defaultCallerId,
        agent: actor.fullName,
        source: 'mobile_app',
        metadata: receiptMeta,
      })
    } catch (error) {
      console.error('[mobile-message] SMS send outcome uncertain; refusing automatic resend', error)
      await transitionMobileMessageSend({ userId: user.id, keyHash, token: claim.token, from: 'sending', to: 'uncertain', status: 409, result: { error: 'SMS delivery outcome is unknown. Do not resend this command.' } })
      return json({ error: 'SMS delivery outcome is unknown. Do not resend this command.' }, 409)
    }
    if (result.status === 'skipped') {
      const error = result.reason === 'opted_out' ? 'This number has opted out of SMS messages' : 'Duplicate SMS sent within 24 hours'
      const status = result.reason === 'opted_out' ? 400 : 409
      await transitionMobileMessageSend({ userId: user.id, keyHash, token: claim.token, from: 'sending', to: 'failed', status, result: { error, sent: false } })
      return json({ error }, status)
    }
    if (result.status === 'failed') {
      const uncertain = result.deliveryState === 'delivery_unknown'
      const error = uncertain ? 'SMS delivery outcome is unknown. Do not resend this command.' : result.error
      const status = uncertain ? 409 : 502
      await transitionMobileMessageSend({ userId: user.id, keyHash, token: claim.token, from: 'sending', to: uncertain ? 'uncertain' : 'failed', status, result: { error, sent: false } })
      return json({ error }, status)
    }
    if (!result.sid) {
      await transitionMobileMessageSend({ userId: user.id, keyHash, token: claim.token, from: 'sending', to: 'uncertain', status: 409, result: { error: 'SMS delivery outcome is unknown. Do not resend this command.' } })
      return json({ error: 'SMS delivery outcome is unknown. Do not resend this command.' }, 409)
    }
    const accepted = { success: true, channel, sent: true, persisted: false, deliveryState: 'provider_accepted_history_pending', sid: result.sid, from: result.from }
    await transitionMobileMessageSend({ userId: user.id, keyHash, token: claim.token, from: 'sending', to: 'provider_accepted', providerId: result.sid, status: 202, result: accepted })
    try {
      await persistActivity(result.sid, true, result.from)
    } catch (error) {
      console.error('[mobile-message] SMS accepted but history persistence failed', error)
      return json({ ...accepted, persisted: false, warning: result.warning || 'SMS was accepted, but CRM history could not be saved. Retry this same command to repair history; do not create a new send.' }, 202)
    }
    return complete(200, { success: true, channel, sent: true, persisted: true, deliveryState: 'provider_accepted_and_persisted', sid: result.sid, from: result.from }, result.sid)
  } catch (error) {
    const status = error instanceof MobileAuthError || error instanceof MobileLeadAccessError ? error.status : 500
    const message = error instanceof Error ? error.message : 'Internal error'
    return json({ error: message }, status)
  }
}
