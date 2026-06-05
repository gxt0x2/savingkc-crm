import { startLeadFormAgentCallback } from '@/lib/lead-form-callback'
import { getLeadAlertRecipients, type LeadAlertRecipient } from '@/lib/lead-alert-routing'
import { sendPushToAgents } from '@/lib/push-notifications'
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

function smsFrom(): string {
  return process.env.TWILIO_PHONE_NUMBER || DEFAULT_SMS_FROM
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
  const recipients = getLeadAlertRecipients(input.now)
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

  if (input.push) {
    sendPushToAgents(input.push).catch((error) => {
      console.error('[lead-team-alerts] push notification failed:', error)
    })
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
