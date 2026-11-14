// Shared single-recipient SMS send — the one place that knows how to text a
// lead correctly: opt-out check, 24h de-dupe, smart "from" number, send via the
// safe Twilio wrapper, log to the comms timeline, and nudge the pipeline.
//
// Both the canonical single-send endpoint (/api/conversations/send) and the bulk
// sender (/api/sms/bulk) call this so they never drift apart.

import { automatedSmsBlockReason, evaluateHumanOneToOneSms } from '@/lib/sms-send-gate'
import { isDuplicateSms, logSmsSend } from '@/lib/sms-dedup'
import { HUMAN_1TO1_SMS_TEMPLATE_ID, humanOneToOneProof, safeSendSMS, type HumanSmsSession } from '@/lib/safe-communications'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { supabase } from '@/lib/supabase-lazy'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { readPhoneEnv } from '@/lib/phone-config'
import { isAllowedSmsSender, normalizeTwilioNumber } from '@/lib/twilio-numbers'

function defaultTwilioPhone(): string {
  return readPhoneEnv('TWILIO_PHONE_NUMBER', '+18163077835')
}
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
  | { status: 'refused'; code: 'sms_quiet_hours' | 'sms_dnc_blocked' | 'sms_registry_dnc'; error: string }
  | { status: 'failed'; error: string; code?: 'automated_sms_disabled'; deliveryState?: 'delivery_unknown' }

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
  /**
   * Set only by a human 1:1 composer. Must be `sms.conversation.1to1.v1`
   * or the shared sender refuses the message.
   */
  templateId?: string
  /** Protected provider request cancellation, checked before Twilio submission. */
  signal?: AbortSignal
  /** Revalidates the dialer operation after provider acceptance and before CRM persistence. */
  beforePersistence?: () => Promise<void>
  /** Clock used for recipient quiet hours. Defaults to the current time. */
  now?: Date
  /** Verified signed-in user. Required for the human 1:1 template. */
  humanSession?: HumanSmsSession | null
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

  return defaultTwilioPhone()
}

export { HUMAN_1TO1_SMS_TEMPLATE_ID }

function notedWarning(warning: string | undefined, phoneWarnings: string[]): string | undefined {
  if (!phoneWarnings.length) return warning
  const note = `Noted ${phoneWarnings.join(', ')} on this number. The text was not blocked.`
  return warning ? `${warning} ${note}` : note
}

export async function sendLeadSms(input: SendLeadSmsInput): Promise<SendLeadSmsResult> {
  const { leadId, phone, fromPhone, agent, source, metadata, statusCallback, templateId, signal, beforePersistence, now, humanSession } = input
  const body = input.body.trim()

  if (!humanOneToOneProof({ templateId, to: phone, humanSession })) {
    const msg = await safeSendSMS({
      body,
      from: fromPhone || '',
      to: typeof phone === 'string' ? phone : '',
      senderUse: 'conversation',
      statusCallback,
      templateId,
      humanSession,
      signal,
    })
    return {
      status: 'failed',
      code: 'automated_sms_disabled',
      error: msg.error || `Automated SMS is disabled. Only a human-initiated 1:1 send (${HUMAN_1TO1_SMS_TEMPLATE_ID}) is allowed.`,
    }
  }

  const decision = await evaluateHumanOneToOneSms({ phone, leadId: leadId ?? null, now })
  if (!decision.ok) return { status: 'refused', code: decision.code, error: decision.error }

  if (await automatedSmsBlockReason({ phone, leadId: leadId ?? null })) return { status: 'skipped', reason: 'opted_out' }
  if (await isDuplicateSms(phone, body)) return { status: 'skipped', reason: 'duplicate' }

  const from = await resolveSmsFromNumber(leadId, phone, fromPhone)
  const msg = await safeSendSMS({
    body,
    from,
    to: phone,
    senderUse: 'conversation',
    statusCallback,
    templateId,
    humanSession,
    signal,
    beforePostProviderWrite: beforePersistence,
  })
  if (msg.deliveryUnknown) {
    return {
      status: 'failed',
      error: msg.error || 'Twilio did not return a confirmed delivery result. Do not resend this message.',
      deliveryState: 'delivery_unknown',
    }
  }
  if (!msg.success) return { status: 'failed', error: msg.error || 'SMS send failed' }

  if (msg.postProviderPersistenceBlocked) {
    return {
      status: 'sent',
      sid: msg.sid,
      from: msg.from,
      persisted: false,
      deliveryState: 'delivered_not_persisted',
      warning: notedWarning('SMS delivered, but CRM history could not be saved. Do not resend this message.', decision.warnings),
    }
  }

  if (beforePersistence) {
    try {
      await beforePersistence()
    } catch (error) {
      console.error('[SMS-SENDER] SMS delivered but dialing control could not be revalidated:', error)
      return {
        status: 'sent',
        sid: msg.sid,
        from: msg.from,
        persisted: false,
        deliveryState: 'delivered_not_persisted',
        warning: notedWarning('SMS delivered, but CRM history could not be saved. Do not resend this message.', decision.warnings),
      }
    }
  }

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
        ...(decision.cold ? {
          consent_basis: 'owner_accepted_cold_1to1',
          sender_line: msg.from,
          registry_status: decision.registryStatus,
        } : {}),
        ...(decision.warnings.length ? { phone_warnings: decision.warnings } : {}),
      },
    })
    persistenceError = persistence.error
  } catch (error) {
    persistenceError = error
  }

  if (beforePersistence) {
    try {
      await beforePersistence()
      await logSmsSend(phone, body, msg.from, leadId || undefined)
        .catch((err) => console.error('[SMS-DEDUP] Failed:', err))

      if (leadId) {
        await checkAutoAdvance(leadId, 'outbound_contact', { beforeMutation: beforePersistence })
          .catch((err) => console.error('[AUTO-ADVANCE] Failed:', err))
      }
    } catch (error) {
      console.error('[SMS-SENDER] Protected follow-up CRM writes were skipped after dialing control changed:', error)
    }
  } else {
    logSmsSend(phone, body, msg.from, leadId || undefined).catch((err) => console.error('[SMS-DEDUP] Failed:', err))

    if (leadId) {
      checkAutoAdvance(leadId, 'outbound_contact').catch((err) => console.error('[AUTO-ADVANCE] Failed:', err))
    }
  }

  if (persistenceError) {
    console.error('[SMS-SENDER] SMS delivered but activity persistence failed:', persistenceError)
    return {
      status: 'sent',
      sid: msg.sid,
      from: msg.from,
      persisted: false,
      deliveryState: 'delivered_not_persisted',
      warning: notedWarning('SMS delivered, but CRM history could not be saved. Do not resend this message.', decision.warnings),
    }
  }

  return {
    status: 'sent',
    sid: msg.sid,
    from: msg.from,
    persisted: true,
    deliveryState: 'delivered_and_persisted',
    warning: notedWarning(undefined, decision.warnings),
  }
}
