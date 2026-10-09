import { startLeadFormAgentCallback } from '@/lib/lead-form-callback'
import { getLeadAlertRecipients, type LeadAlertRecipient } from '@/lib/lead-alert-routing'
import { sendMobilePushToAgentNames } from '@/lib/mobile-push'
import { sendPushToAgentNames } from '@/lib/push-notifications'
import { safeSendSMS } from '@/lib/safe-communications'
import { supabase } from '@/lib/supabase-lazy'

const DEFAULT_SMS_FROM = '+18163077835'

type CallbackInput = {
  leadPhone: string | null | undefined
  callerId: string | null | undefined
  fullName: string
  address?: string | null
  city?: string | null
  trigger: string
}

type PushInput = {
  title: string
  body: string
  url: string
  tag: string
}

type TeamLeadAlertInput = {
  leadId?: string | null
  smsBody: string
  trigger: string
  source?: string | null
  trafficSource?: string | null
  now?: Date
  calledNumber?: string | null
  push?: PushInput | false
  callback?: CallbackInput | false
  metadata?: Record<string, unknown>
}

export type TeamLeadAlertResult = {
  recipients: LeadAlertRecipient[]
  smsResults: Array<{
    target: LeadAlertRecipient['name']
    phone: string
    success: boolean
    sid?: string
    error?: string
  }>
  callback: Awaited<ReturnType<typeof startLeadFormAgentCallback>> | null
}

type MobileAlertKind = 'inbound_sms' | 'missed_call' | 'voicemail'

function smsFrom(): string {
  return process.env.TWILIO_PHONE_NUMBER || DEFAULT_SMS_FROM
}

function metaSid(metadata: Record<string, unknown> | undefined, keys: string[]): string {
  for (const key of keys) {
    const value = metadata?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function teamAlertMobileKind(trigger: string): MobileAlertKind | null {
  const value = trigger.toLowerCase()
  if (value.includes('voicemail')) return 'voicemail'
  if (value.includes('missed_call')) return 'missed_call'
  if (value.includes('sms')) return 'inbound_sms'
  return null
}

function teamAlertEventId(kind: MobileAlertKind, metadata: Record<string, unknown> | undefined, fallback: string): string {
  if (kind === 'inbound_sms') return `sms_${metaSid(metadata, ['messageSid', 'message_sid']) || fallback}`
  if (kind === 'voicemail') return `vm_${metaSid(metadata, ['recordingSid', 'callSid']) || fallback}`
  return `call_${metaSid(metadata, ['callSid']) || fallback}`
}

function teamAlertMobilePush(input: TeamLeadAlertInput, names: Array<LeadAlertRecipient['name']>) {
  if (!input.push || names.length === 0) return null
  const kind = teamAlertMobileKind(input.trigger)
  if (!kind) return null
  const leadId = input.leadId || ''
  return {
    title: input.push.title,
    body: input.push.body,
    data: {
      href: leadId ? `/conversation/${leadId}` : '/conversations',
      kind,
      leadId,
      eventId: teamAlertEventId(kind, input.metadata, input.push.tag),
    },
  }
}

function deliveryStatus(
  results: Array<{
    target: LeadAlertRecipient['name']
    phone: string
    success: boolean
    sid?: string
    error?: string
  }>,
) {
  return results.map((result) => ({
    target: result.target,
    to: result.phone,
    success: result.success,
    sid: result.sid,
    error: result.error,
  }))
}

export async function sendTeamLeadAlert(input: TeamLeadAlertInput): Promise<TeamLeadAlertResult> {
  const recipients = getLeadAlertRecipients(input.now, input.calledNumber)
  const from = smsFrom()

  const smsResults = from && recipients.length > 0
    ? await Promise.all(
      recipients.map(async (recipient) => {
        const result = await safeSendSMS({
          body: input.smsBody,
          from,
          to: recipient.phone,
        })
        return {
          target: recipient.name,
          phone: recipient.phone,
          success: result.success,
          sid: result.sid,
          error: result.error,
        }
      }),
    )
    : []

  if (input.push && recipients.length > 0) {
    const names = recipients.map((recipient) => recipient.name)
    sendPushToAgentNames(names, input.push).catch((error) => {
      console.error('[lead-team-alerts] push notification failed:', error)
    })
    const mobile = teamAlertMobilePush(input, names)
    if (mobile) {
      sendMobilePushToAgentNames(names, mobile).catch((error) => {
        console.error('[lead-team-alerts] mobile push notification failed:', error)
      })
    }
  }

  const callback = input.callback && input.leadId && input.callback.leadPhone && input.callback.callerId
    ? await startLeadFormAgentCallback({
      leadId: input.leadId,
      leadPhone: input.callback.leadPhone,
      callerId: input.callback.callerId,
      fullName: input.callback.fullName,
      address: input.callback.address,
      city: input.callback.city,
      trigger: input.callback.trigger,
    })
    : null

  if (input.leadId) {
    await supabase.from('lead_activities').insert({
      lead_id: input.leadId,
      activity_type: 'sms',
      description: input.smsBody,
      agent: 'System',
      metadata: {
        direction: 'outbound_alert',
        trigger: input.trigger,
        source: input.source ?? null,
        traffic_source: input.trafficSource ?? null,
        to_agents: recipients.map((recipient) => recipient.name),
        to_agent_phones: recipients.map((recipient) => recipient.phone),
        alert_schedule: recipients.map((recipient) => ({
          name: recipient.name,
          schedule: recipient.schedule,
        })),
        delivery_status: deliveryStatus(smsResults),
        ...(callback ? { form_agent_callback: callback } : {}),
        ...(input.metadata ?? {}),
      },
    })
  }

  return { recipients, smsResults, callback }
}
