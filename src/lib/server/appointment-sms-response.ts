import { supabaseAdmin } from '@/lib/supabase/admin'
import { isUniqueViolation, stableWebhookActivityId } from '@/lib/telephony/webhook-idempotency'

const CONFIRM_KEYWORDS = new Set([
  '1', 'YES', 'YES!', 'Y', 'YEP', 'YEAH', 'YA', 'OK', 'OKAY', 'SURE',
  'SOUNDS GOOD', 'CONFIRM', 'CONFIRMED', 'CONFIRM!', 'YES PLEASE', 'PERFECT',
  'SEE YOU THEN', 'WILL BE THERE', 'IM GOOD', "I'M GOOD", 'WORKS FOR ME',
])

const RESCHEDULE_PHRASES = [
  'reschedule', "can't make it", 'cant make it', 'another time', 'push back',
  'different day', 'different time',
]

export type AppointmentSmsReply = 'confirm' | 'reschedule' | null

export function classifyAppointmentSmsReply(message: string): AppointmentSmsReply {
  const trimmed = message.trim()
  const upper = trimmed.toUpperCase()
  if (CONFIRM_KEYWORDS.has(upper)) return 'confirm'
  const lower = trimmed.toLowerCase()
  if (RESCHEDULE_PHRASES.some((phrase) => lower.includes(phrase)) || /\bmove\b/.test(lower)) {
    return 'reschedule'
  }
  return null
}

export interface AppointmentSmsResponseResult {
  handled: boolean
  appointmentId?: string
  response?: Exclude<AppointmentSmsReply, null>
}

export async function recordAppointmentSmsResponse(input: {
  leadId: string
  message: string
  messageSid: string | null
}): Promise<AppointmentSmsResponseResult> {
  const response = classifyAppointmentSmsReply(input.message)
  if (!response) return { handled: false }

  const db = supabaseAdmin()
  const lowerBound = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  const { data: appointment, error: loadError } = await db
    .from('appointments')
    .select('id, status, scheduled_at')
    .eq('lead_id', input.leadId)
    .in('status', ['scheduled', 'confirmed', 'rescheduled'])
    .gte('scheduled_at', lowerBound)
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (loadError) throw new Error(`Appointment response lookup failed: ${loadError.message}`)
  if (!appointment) return { handled: false }

  const nextStatus = response === 'confirm' ? 'confirmed' : 'rescheduled'
  const now = new Date().toISOString()
  const { error: updateError } = await db
    .from('appointments')
    .update({ status: nextStatus, updated_at: now })
    .eq('id', appointment.id)
    .eq('lead_id', input.leadId)
  if (updateError) throw new Error(`Appointment response update failed: ${updateError.message}`)

  const eventType = response === 'confirm' ? 'appointment_confirmed' : 'appointment_reschedule_requested'
  const providerKey = input.messageSid || `${input.leadId}:${appointment.id}:${eventType}:${input.message.trim()}`
  const { error: activityError } = await db.from('lead_activities').insert({
    id: stableWebhookActivityId(eventType, providerKey),
    lead_id: input.leadId,
    activity_type: eventType,
    description: response === 'confirm'
      ? 'Seller confirmed appointment via SMS'
      : 'Seller requested a different appointment time via SMS',
    agent: 'Seller',
    metadata: {
      appointment_id: appointment.id,
      response,
      source: 'sms_reply',
      message_sid: input.messageSid,
      recorded_at: now,
    },
  })
  if (activityError && !isUniqueViolation(activityError)) {
    throw new Error(`Appointment response timeline failed: ${activityError.message}`)
  }

  return { handled: true, appointmentId: appointment.id, response }
}
