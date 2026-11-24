import { afterRequest } from '@/lib/after-request'
import { CASEY_COMPANY_NUMBER, getLeadAlertRecipients } from '@/lib/lead-alert-routing'
import { sendMobilePushToAgentNames } from '@/lib/mobile-push'
import {
  getConversationDirection,
  isInternalConversationActivity,
} from '@/lib/operating-model/conversation-presentation'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { sendPushToAgentNames, sendPushToAgents } from '@/lib/push-notifications'

/** Team handsets. Inbound from these numbers is internal coordination, not a seller lead. */
const TEAM_NUMBERS = new Set([
  '+18167564943', // Casey personal
  '+18167277667', // Casey company
  '+18166088588', // Ernest company
  '+18162262552', // Ernest forwarding / personal
])

export function isTeamCompanyLineSender(phone: string): boolean {
  return TEAM_NUMBERS.has(normalizePhoneToE164(phone) || phone)
}

export function teamInboundSenderName(phone: string): string {
  const normalized = normalizePhoneToE164(phone) || phone
  const casey = normalizePhoneToE164(process.env.CASEY_PHONE) || '+18167564943'
  const ernest = normalizePhoneToE164(process.env.ERNEST_PHONE) || '+18162262552'
  if (normalized === casey) return 'Casey'
  if (normalized === ernest) return 'Ernest'
  if (normalized === '+18166088588') return 'Ernest (co)'
  if (normalized === '+18167277667') return 'Casey (co)'
  return 'Team'
}

export interface InboundConversationTarget {
  threadId: string
  href: string
  url: string
}

/** Lead thread when identity is resolved; otherwise the unmatched phone thread. */
export function inboundConversationTarget(
  leadId: string | null | undefined,
  fromPhone: string,
): InboundConversationTarget {
  const phone = normalizePhoneToE164(fromPhone)
  const resolvedLead = leadId && !leadId.startsWith('unmatched:') && !leadId.startsWith('phone:')
    ? leadId
    : null
  const threadId = resolvedLead || (phone ? `unmatched:${phone}` : '')
  if (!threadId) throw new Error('Inbound SMS has no conversation thread')
  return {
    threadId,
    href: `/conversation/${threadId}`,
    url: `/conversations?lead=${encodeURIComponent(threadId)}`,
  }
}

type InboxActivity = {
  lead_id?: string | null
  activity_type: string
  description?: string | null
  metadata?: Record<string, unknown> | null
}

/** Mirrors the conversation projection: customer SMS with a lead or phone becomes an inbox row. */
export function inboundSmsInboxRow(activity: InboxActivity): {
  visible: boolean
  threadId: string | null
  threadKey: string | null
} {
  const metadata = activity.metadata ?? {}
  const view = {
    activity_type: activity.activity_type,
    description: activity.description ?? null,
    metadata,
  }
  if (isInternalConversationActivity(view) || !getConversationDirection(view)) {
    return { visible: false, threadId: null, threadKey: null }
  }
  if (activity.lead_id) {
    return { visible: true, threadId: activity.lead_id, threadKey: `lead:${activity.lead_id}` }
  }
  const phone = normalizePhoneToE164(typeof metadata.from === 'string' ? metadata.from : null)
  if (!phone) return { visible: false, threadId: null, threadKey: null }
  return { visible: true, threadId: `unmatched:${phone}`, threadKey: `phone:${phone}` }
}

type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

export function queueInboundSmsPush(
  to: string,
  payload: PushPayload,
  context: { leadId?: string | null; from: string; messageSid: string },
) {
  const target = inboundConversationTarget(context.leadId, context.from)
  const alert = { ...payload, url: target.url }
  afterRequest(() => {
    const names = getLeadAlertRecipients(new Date(), to).map((recipient) => recipient.name)
    const web = to !== CASEY_COMPANY_NUMBER
      ? sendPushToAgents(alert)
      : sendPushToAgentNames(names, alert)
    const mobile = sendMobilePushToAgentNames(names, {
      title: payload.title,
      body: payload.body,
      data: {
        href: target.href,
        kind: 'inbound_sms',
        leadId: target.threadId,
        eventId: `sms_${context.messageSid}`,
      },
    })
    return Promise.all([web, mobile])
  })
}
