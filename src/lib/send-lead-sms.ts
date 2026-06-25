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
const SMS_ACTIVITY_TYPES = ['sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound']

type SmsActivityRow = {
  activity_type: string
  metadata: Record<string, unknown> | null
  created_at: string
}

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
  source?: string
  metadata?: Record<string, unknown>
}

/**
 * Pick the Twilio number to send from. Prefer the number this lead/phone last
 * used with this contact (keeps the thread on one number); otherwise the
 * explicit override; otherwise the default line.
 */
export async function resolveSmsFromNumber(
  leadId: string | null | undefined,
  phone: string,
  fromPhone?: string,
): Promise<string> {
  if (fromPhone) return fromPhone

  function textValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }

  function phoneKey(value: string | null | undefined): string {
    const digits = (value || '').replace(/\D/g, '')
    if (!digits) return ''
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  }

  function phoneVariants(raw: string): string[] {
    const digits = raw.replace(/\D/g, '')
    const variants = new Set<string>()
    if (raw.trim()) variants.add(raw.trim())
    const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
    if (national.length === 10) {
      variants.add(`+1${national}`)
      variants.add(national)
      variants.add(`${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`)
      variants.add(`(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`)
    }
    return Array.from(variants)
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

  if (leadId) {
    const { data } = await supabase
      .from('lead_activities')
      .select('activity_type, metadata, created_at')
      .eq('lead_id', leadId)
      .in('activity_type', SMS_ACTIVITY_TYPES)
      .order('created_at', { ascending: false })
      .limit(200)
    const rows = (data || []) as SmsActivityRow[]
    const match = rows.find((row) => phoneKey(contactPhone(row)) === targetKey && linePhone(row))
    const detectedLine = match ? linePhone(match) : null
    if (detectedLine) return detectedLine
  }

  if (phone) {
    const variants = phoneVariants(phone)
    const [{ data: fromRows }, { data: toRows }] = await Promise.all([
      supabase
        .from('lead_activities')
        .select('activity_type, metadata, created_at')
        .in('activity_type', SMS_ACTIVITY_TYPES)
        .in('metadata->>from', variants)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('lead_activities')
        .select('activity_type, metadata, created_at')
        .in('activity_type', SMS_ACTIVITY_TYPES)
        .in('metadata->>to', variants)
        .order('created_at', { ascending: false })
        .limit(20),
    ])
    const rows = ([...(fromRows || []), ...(toRows || [])] as SmsActivityRow[])
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    const match = rows.find((row) => phoneKey(contactPhone(row)) === targetKey && linePhone(row))
    const detectedLine = match ? linePhone(match) : null
    if (detectedLine) return detectedLine
  }

  return DEFAULT_TWILIO_PHONE
}

export async function sendLeadSms(input: SendLeadSmsInput): Promise<SendLeadSmsResult> {
  const { leadId, phone, fromPhone, agent, source, metadata } = input
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
    metadata: {
      ...(metadata || {}),
      ...(source ? { source } : {}),
      direction: 'outbound',
      from,
      to: phone,
      message_sid: msg.sid,
    },
  })

  logSmsSend(phone, body, from, leadId || undefined).catch((err) => console.error('[SMS-DEDUP] Failed:', err))

  if (leadId) {
    checkAutoAdvance(leadId, 'outbound_contact').catch((err) => console.error('[AUTO-ADVANCE] Failed:', err))
    onCommunicationEvent(leadId, { type: 'outbound_sms', content: body }).catch((err) => console.error('[MANIFEST-SYNC] Failed:', err))
  }

  return { status: 'sent', sid: msg.sid, from }
}
