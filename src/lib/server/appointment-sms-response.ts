import { isSmsOptOutMessage } from '@/lib/sms-opt-out'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { stableWebhookActivityId } from '@/lib/telephony/webhook-idempotency'

const CONFIRM_KEYWORDS = new Set(['1', 'YES', 'Y', 'YEP', 'YEAH', 'YA', 'OK', 'OKAY', 'SURE', 'SOUNDS GOOD', 'CONFIRM', 'CONFIRMED', 'YES PLEASE', 'PERFECT', 'SEE YOU THEN', 'WILL BE THERE', 'IM GOOD', "I'M GOOD", 'WORKS FOR ME'])
const RESCHEDULE_PHRASES = ['reschedule', "can't make it", 'cant make it', 'another time', 'push back', 'different day', 'different time', 'can we do', 'could we do', 'cancel', 'not coming', 'will not', "won't"]
export type AppointmentSmsReply = 'confirm' | 'reschedule' | null

export function classifyAppointmentSmsReply(message: string): AppointmentSmsReply {
  const text = message.trim().replace(/[.!]+$/, '')
  const lower = text.toLowerCase()
  if (RESCHEDULE_PHRASES.some(phrase => lower.includes(phrase)) || /\bmove\b/.test(lower) || /^(no|nope|nah)$/.test(lower)) return 'reschedule'
  return CONFIRM_KEYWORDS.has(text.toUpperCase()) ? 'confirm' : null
}

export interface AppointmentSmsResponseResult { handled: boolean; appointmentId?: string; response?: 'confirm' | 'reschedule' | 'review' }

export async function recordAppointmentSmsResponse(input: { leadId: string; message: string; messageSid: string | null }): Promise<AppointmentSmsResponseResult> {
  if (isSmsOptOutMessage(input.message) || /^(start|unstop|help)$/i.test(input.message.trim())) return { handled: false }
  const response = classifyAppointmentSmsReply(input.message) || 'review'
  const providerKey = input.messageSid || `${input.leadId}:${response}:${input.message.trim()}`
  const { data, error } = await supabaseAdmin().rpc('appointment_sequence_reply_v1', {
    p_lead_id: input.leadId, p_response: response,
    p_event_id: stableWebhookActivityId('appointment_reply', providerKey), p_message_sid: input.messageSid,
  })
  if (error) throw new Error(`Appointment response update failed: ${error.message}`)
  return typeof data === 'string' ? { handled: true, appointmentId: data, response } : { handled: false }
}
