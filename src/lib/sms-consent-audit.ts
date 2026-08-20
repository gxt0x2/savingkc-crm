import { phoneLookupVariants } from '@/lib/google-ads-phone'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { handleOptIn, handleOptOut, isOptedOut, isStartKeyword, isStopKeyword } from '@/lib/sms-opt-out'
import { supabase } from '@/lib/supabase-lazy'
import { isUniqueViolation, stableWebhookActivityId } from '@/lib/telephony/webhook-idempotency'

export interface SmsConsentAuditInput {
  from: string
  to: string | null
  keyword: string
  messageSid: string | null
  source: 'twilio_sms_webhook' | 'carrier_sms_fallback'
}

interface InboundSmsConsentInput extends SmsConsentAuditInput {
  allowYesOptIn?: boolean
}

const OPT_OUT_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Message>You have been unsubscribed from Saving KC messages. Reply START to re-subscribe.</Message></Response>'
const OPT_IN_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Message>You have been re-subscribed to Saving KC messages. Reply STOP to unsubscribe.</Message></Response>'

/** Apply carrier consent commands before any normal inbound-message processing. */
export async function processInboundSmsConsent(input: InboundSmsConsentInput): Promise<string | null> {
  if (isStopKeyword(input.keyword)) {
    await persistSmsOptOutWithAudit(input)
    return OPT_OUT_TWIML
  }
  if (isStartKeyword(input.keyword) || (
    input.allowYesOptIn === true &&
    input.keyword.trim().toUpperCase() === 'YES' &&
    await isOptedOut(input.from)
  )) {
    await handleOptIn(input.from)
    return OPT_IN_TWIML
  }
  return null
}

/** Persist STOP first; audit failure is visible in logs but never reverses consent. */
export async function persistSmsOptOutWithAudit(input: SmsConsentAuditInput): Promise<void> {
  await handleOptOut(input.from, input.keyword.trim())
  try {
    await recordSmsOptOutActivity(input)
  } catch (error) {
    console.error(`[${input.source}] SMS opt-out audit failed:`, error)
  }
}

/** Record a durable, idempotent explanation for a successfully persisted STOP. */
export async function recordSmsOptOutActivity(input: SmsConsentAuditInput): Promise<void> {
  let leadId: string | null = null
  for (const variant of phoneLookupVariants(input.from)) {
    const { data, error } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', variant)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error('SMS opt-out lead lookup failed')
    if (data?.id) {
      leadId = data.id
      break
    }
  }

  const phone = normalizePhoneToE164(input.from) ?? input.from.trim()
  const messageSid = input.messageSid?.trim() || null
  const { error } = await supabase.from('lead_activities').insert({
    ...(messageSid ? { id: stableWebhookActivityId('sms-opt-out', messageSid) } : {}),
    lead_id: leadId,
    activity_type: 'status_change',
    description: `SMS opt-out recorded (${input.keyword.trim().toUpperCase()})`,
    agent: 'System',
    metadata: {
      source: input.source,
      event: 'sms_opt_out',
      hub_action: 'mark_read',
      phone,
      from: phone,
      ...(input.to ? { to: input.to } : {}),
      ...(messageSid ? { message_sid: messageSid } : {}),
    },
  })

  if (error && !isUniqueViolation(error)) throw new Error('SMS opt-out activity could not be saved')
}
