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

const DEFAULT_TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'

export type SendLeadSmsResult =
  | { status: 'sent'; sid: string | undefined; from: string }
  | { status: 'skipped'; reason: 'opted_out' | 'duplicate' }
  | { status: 'failed'; error: string }

export interface SendLeadSmsInput {
  leadId?: string | null
  phone: string
  body: string
  /** Force a specific Twilio sending number; otherwise auto-detected. */
  fromPhone?: string
  agent?: string
}

/**
 * Pick the Twilio number to send from. Prefer the number this lead/phone last
 * texted us on (keeps the thread on one number); otherwise the explicit
 * override; otherwise the default line.
 */
export async function resolveSmsFromNumber(
  leadId: string | null | undefined,
  phone: string,
  fromPhone?: string,
): Promise<string> {
  if (fromPhone) return fromPhone

  if (leadId) {
    const { data } = await supabase
      .from('lead_activities')
      .select('metadata')
      .eq('lead_id', leadId)
      .eq('activity_type', 'sms')
      .eq('metadata->>direction', 'received')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (data?.metadata?.to) return data.metadata.to as string
  }

  if (phone) {
    const { data } = await supabase
      .from('lead_activities')
      .select('metadata')
      .eq('activity_type', 'sms')
      .eq('metadata->>direction', 'received')
      .eq('metadata->>from', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (data?.metadata?.to) return data.metadata.to as string
  }

  return DEFAULT_TWILIO_PHONE
}

export async function sendLeadSms(input: SendLeadSmsInput): Promise<SendLeadSmsResult> {
  const { leadId, phone, fromPhone, agent } = input
  const body = input.body.trim()

  if (await isOptedOut(phone)) return { status: 'skipped', reason: 'opted_out' }
  if (await isDuplicateSms(phone, body)) return { status: 'skipped', reason: 'duplicate' }

  const from = await resolveSmsFromNumber(leadId, phone, fromPhone)
  const msg = await safeSendSMS({ body, from, to: phone })
  if (!msg.success) return { status: 'failed', error: msg.error || 'SMS send failed' }

  await supabase.from('lead_activities').insert({
    lead_id: leadId || null,
    activity_type: 'sms',
    description: body,
    agent: agent || 'System',
    metadata: { direction: 'outbound', from, to: phone, message_sid: msg.sid },
  })

  logSmsSend(phone, body, from, leadId || undefined).catch((err) => console.error('[SMS-DEDUP] Failed:', err))

  if (leadId) {
    checkAutoAdvance(leadId, 'outbound_contact').catch((err) => console.error('[AUTO-ADVANCE] Failed:', err))
    onCommunicationEvent(leadId, { type: 'outbound_sms', content: body }).catch((err) => console.error('[MANIFEST-SYNC] Failed:', err))
  }

  return { status: 'sent', sid: msg.sid, from }
}
