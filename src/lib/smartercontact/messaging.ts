/**
 * Unified messaging core for the SmarterContact module.
 *
 * All SMS in/out flow through here so the inbox (`sc_conversations` +
 * `sc_messages`) stays consistent regardless of origin (campaign, workflow,
 * keyword auto-reply, or a manual reply from the inbox). Reuses the existing
 * `safeSendSMS` primitive (TEST_MODE aware, logs to sms_delivery_log) and the
 * existing `sms_opt_outs` suppression table.
 */
import { supabaseAdmin } from '@/lib/supabase/admin'
import { safeSendSMS } from '@/lib/safe-communications'
import { isOptedOut } from '@/lib/sms-opt-out'
import { pickSendingNumber, recordSendByPhone } from './numbers'

const DEFAULT_FROM = process.env.TWILIO_PHONE_NUMBER || '+18163077835'

/** Rough SMS segment count (GSM-7 assumed): 160 for a single, 153 per concat segment. */
export function segmentCount(body: string): number {
  const len = body.length
  if (len <= 160) return 1
  return Math.ceil(len / 153)
}

interface Conversation {
  id: string
  contact_id: string | null
  contact_phone: string
  sending_number: string | null
  status: string
}

/** Find (or create) the conversation thread for a far-end phone. */
export async function getOrCreateConversation(
  contactPhone: string,
  contactId?: string | null,
): Promise<Conversation> {
  const db = supabaseAdmin()
  const { data: existing } = await db
    .from('sc_conversations')
    .select('id, contact_id, contact_phone, sending_number, status')
    .eq('contact_phone', contactPhone)
    .maybeSingle()
  if (existing) {
    // Re-open a deleted thread on new activity; attach contact if newly known.
    if (existing.status === 'deleted' || (contactId && !existing.contact_id)) {
      const patch: Record<string, unknown> = {}
      if (existing.status === 'deleted') patch.status = 'open'
      if (contactId && !existing.contact_id) patch.contact_id = contactId
      await db.from('sc_conversations').update(patch).eq('id', existing.id)
    }
    return existing as Conversation
  }
  const { data: created, error } = await db
    .from('sc_conversations')
    .insert({ contact_phone: contactPhone, contact_id: contactId ?? null })
    .select('id, contact_id, contact_phone, sending_number, status')
    .single()
  if (error) throw new Error(`getOrCreateConversation: ${error.message}`)
  return created as Conversation
}

/** Record an inbound message + update thread state (unread, replied). */
export async function recordInbound(params: {
  fromPhone: string
  toPhone: string
  body: string
  twilioSid?: string
  missedCall?: boolean
}): Promise<{ conversationId: string }> {
  const db = supabaseAdmin()
  const convo = await getOrCreateConversation(params.fromPhone)
  await db.from('sc_messages').insert({
    conversation_id: convo.id,
    contact_id: convo.contact_id,
    contact_phone: params.fromPhone,
    sending_number: params.toPhone,
    direction: 'inbound',
    body: params.body,
    segments: segmentCount(params.body),
    status: 'received',
    twilio_sid: params.twilioSid ?? null,
  })
  // Bump unread count atomically-ish; single webhook writer so RMW is fine.
  const { data: cur } = await db
    .from('sc_conversations')
    .select('unread_count')
    .eq('id', convo.id)
    .single()
  await db
    .from('sc_conversations')
    .update({
      last_message_at: new Date().toISOString(),
      last_direction: 'inbound',
      last_body: params.body.slice(0, 500),
      unread_count: (cur?.unread_count || 0) + 1,
      is_read: false,
      awaiting_reply: false,
      has_replied: true,
      missed_call: params.missedCall ? true : undefined,
      sending_number: params.toPhone,
    })
    .eq('id', convo.id)
  return { conversationId: convo.id }
}

/** Record an outbound message + update thread state (awaiting reply). */
export async function recordOutbound(params: {
  toPhone: string
  fromPhone: string
  body: string
  twilioSid?: string
  status?: 'queued' | 'sent' | 'delivered' | 'failed' | 'undelivered'
  contactId?: string | null
  campaignId?: string | null
  workflowId?: string | null
}): Promise<{ conversationId: string }> {
  const db = supabaseAdmin()
  const convo = await getOrCreateConversation(params.toPhone, params.contactId)
  await db.from('sc_messages').insert({
    conversation_id: convo.id,
    contact_id: params.contactId ?? convo.contact_id,
    contact_phone: params.toPhone,
    sending_number: params.fromPhone,
    direction: 'outbound',
    body: params.body,
    segments: segmentCount(params.body),
    status: params.status ?? 'sent',
    twilio_sid: params.twilioSid ?? null,
    campaign_id: params.campaignId ?? null,
    workflow_id: params.workflowId ?? null,
  })
  await db
    .from('sc_conversations')
    .update({
      last_message_at: new Date().toISOString(),
      last_direction: 'outbound',
      last_body: params.body.slice(0, 500),
      awaiting_reply: true,
      sending_number: params.fromPhone,
    })
    .eq('id', convo.id)
  return { conversationId: convo.id }
}

export interface ScSendResult {
  success: boolean
  skipped?: 'opted_out' | 'no_number'
  sid?: string
  from?: string
  error?: string
}

/**
 * Send an SMS through the pool and record it in the unified inbox.
 * - Suppression-checked (sms_opt_outs).
 * - "Sticky" to the conversation's existing sending number when active,
 *   otherwise rotates a healthy number from the pool.
 */
export async function scSendSms(params: {
  toPhone: string
  body: string
  poolIds?: string[]
  contactId?: string | null
  campaignId?: string | null
  workflowId?: string | null
  forceFrom?: string
  sticky?: boolean
}): Promise<ScSendResult> {
  if (await isOptedOut(params.toPhone)) {
    return { success: false, skipped: 'opted_out' }
  }

  let from = params.forceFrom
  if (!from && params.sticky !== false) {
    // Reuse the number already used with this contact, if any.
    const db = supabaseAdmin()
    const { data } = await db
      .from('sc_conversations')
      .select('sending_number')
      .eq('contact_phone', params.toPhone)
      .maybeSingle()
    if (data?.sending_number) from = data.sending_number
  }
  if (!from) {
    const num = await pickSendingNumber(params.poolIds)
    if (num) from = num.phone
  }
  if (!from) from = DEFAULT_FROM
  if (!from) return { success: false, skipped: 'no_number' }

  const res = await safeSendSMS({ to: params.toPhone, from, body: params.body })

  await recordOutbound({
    toPhone: params.toPhone,
    fromPhone: from,
    body: params.body,
    twilioSid: res.sid,
    status: res.success ? (res.status as any) || 'sent' : 'failed',
    contactId: params.contactId,
    campaignId: params.campaignId,
    workflowId: params.workflowId,
  })

  // Count every successful send against the sending number (for block-rate math).
  if (res.success) {
    await recordSendByPhone(from).catch((e) =>
      console.error('[SC] recordSendByPhone failed:', e),
    )
  }

  return res.success
    ? { success: true, sid: res.sid, from }
    : { success: false, error: res.error, from }
}

/** Mark a conversation read (clears unread badge). */
export async function markConversationRead(conversationId: string): Promise<void> {
  const db = supabaseAdmin()
  await db
    .from('sc_conversations')
    .update({ is_read: true, unread_count: 0 })
    .eq('id', conversationId)
}
