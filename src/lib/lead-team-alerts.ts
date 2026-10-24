import { afterRequest } from '@/lib/after-request'
import { startLeadFormAgentCallback } from '@/lib/lead-form-callback'
import { getLeadAlertRecipients, type LeadAlertRecipient } from '@/lib/lead-alert-routing'
import { isMobilePushConfigured, sendMobilePushToAgentNames } from '@/lib/mobile-push'
import { isWebPushConfigured, sendPushToAgentNames } from '@/lib/push-notifications'
import { readPhoneEnv } from '@/lib/phone-config'
import { safeSendSMS } from '@/lib/safe-communications'
import { sendCrmTransactionalEmail } from '@/lib/server/transactional-email'
import { supabase } from '@/lib/supabase-lazy'

const DEFAULT_SMS_FROM = '+18163077835'
const AGENT_CRM_EMAIL: Record<LeadAlertRecipient['name'], string> = {
  Ernest: 'ernest@savingkc.com',
  Casey: 'casey@savingkc.com',
}

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

export type LeadAlertChannel = 'mobile_push' | 'web_push' | 'email' | 'sms'

export type LeadAlertChannelDelivery = {
  channel: LeadAlertChannel
  target: LeadAlertRecipient['name']
  to: string | null
  success: boolean
  status: string
  sid: string | null
  error: string | null
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
  channelResults: LeadAlertChannelDelivery[]
  callback: Awaited<ReturnType<typeof startLeadFormAgentCallback>> | null
}

type MobileAlertKind = 'inbound_sms' | 'missed_call' | 'voicemail'

/** Internal new-lead alerts. Reply and missed-call texts are not in this set. */
export function isInternalNewLeadAlert(trigger: string | null | undefined): boolean {
  return /_lead_alert$/.test((trigger || '').trim().toLowerCase())
}

function smsFrom(): string {
  return readPhoneEnv('TWILIO_PHONE_NUMBER', DEFAULT_SMS_FROM)
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Alert delivery failed'
}

function pushCopy(input: TeamLeadAlertInput): PushInput {
  if (input.push) return input.push
  return {
    title: 'New lead',
    body: input.smsBody,
    url: input.leadId ? `/leads/${input.leadId}` : '/leads',
    tag: input.trigger,
  }
}

async function deliverMobilePush(
  recipient: LeadAlertRecipient,
  payload: { title: string; body: string; data: Record<string, string> },
  configured: boolean,
): Promise<LeadAlertChannelDelivery> {
  if (!configured) {
    return {
      channel: 'mobile_push',
      target: recipient.name,
      to: null,
      success: false,
      status: 'not_configured',
      sid: null,
      error: 'Mobile push is not configured',
    }
  }
  try {
    const sent = await sendMobilePushToAgentNames([recipient.name], payload)
    return {
      channel: 'mobile_push',
      target: recipient.name,
      to: null,
      success: sent > 0,
      status: sent > 0 ? 'sent' : 'no_device',
      sid: null,
      error: sent > 0 ? null : 'No registered mobile device accepted the push',
    }
  } catch (error) {
    return {
      channel: 'mobile_push',
      target: recipient.name,
      to: null,
      success: false,
      status: 'failed',
      sid: null,
      error: errorMessage(error),
    }
  }
}

async function deliverWebPush(
  recipient: LeadAlertRecipient,
  payload: PushInput,
  configured: boolean,
): Promise<LeadAlertChannelDelivery> {
  if (!configured) {
    return {
      channel: 'web_push',
      target: recipient.name,
      to: null,
      success: false,
      status: 'not_configured',
      sid: null,
      error: 'Browser push is not configured',
    }
  }
  try {
    const sent = await sendPushToAgentNames([recipient.name], payload)
    return {
      channel: 'web_push',
      target: recipient.name,
      to: null,
      success: sent > 0,
      status: sent > 0 ? 'sent' : 'no_subscription',
      sid: null,
      error: sent > 0 ? null : 'No browser push subscription accepted the alert',
    }
  } catch (error) {
    return {
      channel: 'web_push',
      target: recipient.name,
      to: null,
      success: false,
      status: 'failed',
      sid: null,
      error: errorMessage(error),
    }
  }
}

async function deliverAgentEmail(
  input: TeamLeadAlertInput,
  recipient: LeadAlertRecipient,
  push: PushInput,
): Promise<LeadAlertChannelDelivery> {
  const to = AGENT_CRM_EMAIL[recipient.name]
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000))
  try {
    const result = await sendCrmTransactionalEmail({
      to,
      subject: push.title,
      text: input.smsBody,
      idempotencyKey: `lead-alert-${input.leadId || 'none'}-${input.trigger}-${recipient.name}-${bucket}`,
    })
    return {
      channel: 'email',
      target: recipient.name,
      to,
      success: result.success,
      status: result.status,
      sid: result.id,
      error: result.error,
    }
  } catch (error) {
    return {
      channel: 'email',
      target: recipient.name,
      to,
      success: false,
      status: 'failed',
      sid: null,
      error: errorMessage(error),
    }
  }
}

/**
 * New-lead alerts skip SMS. The automated-SMS guard stays closed.
 * Push and email results are recorded instead of an SMS failure.
 */
async function deliverNewLeadChannels(
  input: TeamLeadAlertInput,
  recipients: LeadAlertRecipient[],
): Promise<LeadAlertChannelDelivery[]> {
  const push = pushCopy(input)
  const mobile = {
    title: push.title,
    body: push.body,
    data: {
      href: push.url,
      kind: 'new_lead',
      leadId: input.leadId || '',
      eventId: `lead_${input.leadId || push.tag}`,
    },
  }
  const mobileReady = isMobilePushConfigured()
  const webReady = isWebPushConfigured()
  const groups = await Promise.all(recipients.map(async (recipient) => {
    const [mobileResult, webResult, emailResult] = await Promise.all([
      deliverMobilePush(recipient, mobile, mobileReady),
      deliverWebPush(recipient, push, webReady),
      deliverAgentEmail(input, recipient, push),
    ])
    return [mobileResult, webResult, emailResult]
  }))
  return groups.flat()
}

function deliveryStatus(
  results: Array<{
    target: LeadAlertRecipient['name']
    phone: string
    success: boolean
    sid?: string
    error?: string
  }>,
): LeadAlertChannelDelivery[] {
  return results.map((result) => ({
    channel: 'sms',
    target: result.target,
    to: result.phone,
    success: result.success,
    status: result.success ? 'sent' : 'failed',
    sid: result.sid ?? null,
    error: result.error ?? null,
  }))
}

export async function sendTeamLeadAlert(input: TeamLeadAlertInput): Promise<TeamLeadAlertResult> {
  const recipients = getLeadAlertRecipients(input.now, input.calledNumber)
  const newLeadAlert = isInternalNewLeadAlert(input.trigger)
  const from = smsFrom()

  const smsResults = !newLeadAlert && from && recipients.length > 0
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

  const channelResults = newLeadAlert && recipients.length > 0
    ? await deliverNewLeadChannels(input, recipients)
    : []

  if (!newLeadAlert && input.push && recipients.length > 0) {
    const names = recipients.map((recipient) => recipient.name)
    const webPush = input.push
    const mobile = teamAlertMobilePush(input, names)
    afterRequest(() => Promise.all([
      sendPushToAgentNames(names, webPush).catch((error) => {
        console.error('[lead-team-alerts] push notification failed:', error)
      }),
      mobile
        ? sendMobilePushToAgentNames(names, mobile).catch((error) => {
          console.error('[lead-team-alerts] mobile push notification failed:', error)
        })
        : Promise.resolve(),
    ]))
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
        ...(newLeadAlert ? {
          sms_status: 'skipped',
          sms_skip_reason: 'automated_sms_disabled',
        } : {}),
        delivery_status: newLeadAlert ? channelResults : deliveryStatus(smsResults),
        ...(callback ? { form_agent_callback: callback } : {}),
        ...(input.metadata ?? {}),
      },
    })
  }

  return { recipients, smsResults, channelResults, callback }
}
