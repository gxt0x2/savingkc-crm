// Shared single-recipient SMS send — the one place that knows how to text a
// lead correctly: opt-out check, 24h de-dupe, smart "from" number, send via the
// safe Twilio wrapper, log to the comms timeline, and nudge the pipeline.
//
// Both the canonical single-send endpoint (/api/conversations/send) and the bulk
// sender (/api/sms/bulk) call this so they never drift apart.

import { isOptedOut } from '@/lib/sms-opt-out'
import { isDuplicateSms, logSmsSend } from '@/lib/sms-dedup'
import { safeSendSMS } from '@/lib/safe-communications'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { onCommunicationEvent } from '@/lib/manifest-sync'
import { supabase } from '@/lib/supabase-lazy'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { isAllowedSmsSender, normalizeTwilioNumber } from '@/lib/twilio-numbers'

const DEFAULT_TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const SMS_ACTIVITY_TYPES = ['sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound']

type SmsActivityRow = {
  activity_type: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export type SendLeadSmsResult =
  | {
      status: 'sent'
      sid: string | undefined
      from: string
      persisted: boolean
      deliveryState: 'delivered_and_persisted' | 'delivered_not_persisted'
      warning?: string
    }
  | { status: 'skipped'; reason: 'opted_out' | 'duplicate' }
  | { status: 'failed'; error: string }

export interface SendLeadSmsInput {
  leadId?: string | null
  phone: string
  body: string
  /** Force a specific Twilio sending number; otherwise auto-detected. */
  fromPhone?: string
  agent?: string
  source?: string
  metadata?: Record<string, unknown>
  statusCallback?: string
}

/**
 * Pick the Twilio number to send from. An explicit session/user choice wins.
 * Without one, preserve the contact's most recent approved conversation line,
 * then use the main line. Historical protected or unknown senders are ignored.
 */
export async function resolveSmsFromNumber(
  leadId: string | null | undefined,
  phone: string,
  fromPhone?: string,
): Promise<string> {
  if (fromPhone) {
    const explicit = normalizeTwilioNumber(fromPhone)
    if (!explicit || !isAllowedSmsSender(explicit, 'conversation')) {
      throw new Error(`SMS sender is not approved for conversations: ${fromPhone}`)
    }
    return explicit
  }

  function textValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }

  function phoneKey(value: string | null | undefined): string {
    const digits = (value || '').replace(/\D/g, '')
    if (!digits) return ''
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  }

  function activityDirection(row: SmsActivityRow): 'inbound' | 'outbound' {
    const direction = textValue(row.metadata?.direction)?.toLowerCase()
    if (direction === 'inbound' || direction === 'received' || direction === 'in') return 'inbound'
    if (row.activity_type === 'sms_received' || row.activity_type === 'sms_inbound') return 'inbound'
    return 'outbound'
  }

  function contactPhone(row: SmsActivityRow): string | null {
    const from = textValue(row.metadata?.from)
    const to = textValue(row.metadata?.to)
    return activityDirection(row) === 'inbound' ? from || to : to || from
  }

  function linePhone(row: SmsActivityRow): string | null {
    const from = textValue(row.metadata?.from)
    const to = textValue(row.metadata?.to)
    return activityDirection(row) === 'inbound' ? to : from
  }

  const targetKey = phoneKey(phone)

  const normalizedPhone = normalizePhoneToE164(phone)
  const threadKey = leadId
    ? `lead:${leadId}`
    : normalizedPhone
      ? `phone:${normalizedPhone}`
      : null
  if (threadKey) {
    const { data, error } = await supabase.rpc('conversation_timeline_page_v1', {
      target_thread_key: threadKey,
      page_limit: 101,
      before_created_at: null,
      before_activity_id: null,
    })
    if (error) {
      console.error('[SMS-SENDER] Conversation line lookup failed:', error.message)
    } else {
      const rows = (data || []) as SmsActivityRow[]
      const match = rows.find((row) => (
        SMS_ACTIVITY_TYPES.includes(row.activity_type) &&
        phoneKey(contactPhone(row)) === targetKey &&
        linePhone(row)
      ))
      const detectedLine = match ? linePhone(match) : null
      if (detectedLine && isAllowedSmsSender(detectedLine, 'conversation')) return normalizeTwilioNumber(detectedLine)!
    }
  }

  return DEFAULT_TWILIO_PHONE
}

export async function sendLeadSms(input: SendLeadSmsInput): Promise<SendLeadSmsResult> {
  const { leadId, phone, fromPhone, agent, source, metadata, statusCallback } = input
  const body = input.body.trim()

  if (await isOptedOut(phone)) return { status: 'skipped', reason: 'opted_out' }
  if (await isDuplicateSms(phone, body)) return { status: 'skipped', reason: 'duplicate' }

  const from = await resolveSmsFromNumber(leadId, phone, fromPhone)
  const msg = await safeSendSMS({ body, from, to: phone, senderUse: 'conversation', statusCallback })
  if (!msg.success) return { status: 'failed', error: msg.error || 'SMS send failed' }

  let persistenceError: unknown = null
  try {
    const persistence = await supabase.from('lead_activities').insert({
      lead_id: leadId || null,
      activity_type: 'sms',
      description: body,
      agent: agent || 'System',
      metadata: {
        ...(metadata || {}),
        ...(source ? { source } : {}),
        direction: 'outbound',
        from: msg.from,
        requested_from: msg.requestedFrom || from,
        sender_mismatch: Boolean(msg.senderMismatch),
        to: phone,
        message_sid: msg.sid,
      },
    })
    persistenceError = persistence.error
  } catch (error) {
    persistenceError = error
  }

  logSmsSend(phone, body, msg.from, leadId || undefined).catch((err) => console.error('[SMS-DEDUP] Failed:', err))

  if (leadId) {
    checkAutoAdvance(leadId, 'outbound_contact').catch((err) => console.error('[AUTO-ADVANCE] Failed:', err))
    onCommunicationEvent(leadId, { type: 'outbound_sms', content: body }).catch((err) => console.error('[MANIFEST-SYNC] Failed:', err))
  }

  if (persistenceError) {
    console.error('[SMS-SENDER] SMS delivered but activity persistence failed:', persistenceError)
    return {
      status: 'sent',
      sid: msg.sid,
      from: msg.from,
      persisted: false,
      deliveryState: 'delivered_not_persisted',
      warning: 'SMS delivered, but CRM history could not be saved. Do not resend this message.',
    }
  }

  return {
    status: 'sent',
    sid: msg.sid,
    from: msg.from,
    persisted: true,
    deliveryState: 'delivered_and_persisted',
  }
}
