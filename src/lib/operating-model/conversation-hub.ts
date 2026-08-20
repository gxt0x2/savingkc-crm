import type { ConversationAttentionState } from './types'
import {
  communicationActivitySummary,
  getCallOutcomePresentation,
  getConversationDirection,
  type CallOutcomePresentation,
} from './conversation-presentation'
import type { ConversationDecisionTag } from './conversation-tags'

export interface ConversationHubLead {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  station: string | null
  priority: string | null
  assigned_agent: string | null
  classification?: 'lead' | 'opportunity' | 'dead' | null
  dead_reason?: string | null
  county?: string | null
  source?: string | null
  motivation_score?: number | null
  arv?: number | null
  offer_amount?: number | null
  appointment_date?: string | null
  decision_tags?: ConversationDecisionTag[]
  created_at: string
}

export interface ConversationHubActivity {
  id: string
  lead_id: string | null
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface ConversationHubThread extends ConversationHubLead {
  attentionState: ConversationAttentionState
  owner: string | null
  unread: boolean
  lastMessage: string
  lastActivityAt: string
  lastChannel: 'call' | 'sms' | 'email' | 'voicemail' | null
  lastCallOutcome: CallOutcomePresentation | null
  primaryNextAction: {
    id: string
    title: string
    dueAt: string | null
    owner: string | null
    overdue: boolean
  } | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const OPEN_CALL_OUTCOMES = new Set([
  'busy',
  'canceled',
  'cancelled',
  'failed',
  'missed',
  'no-answer',
  'no_answer',
  'not-answered',
  'not_answered',
  'voicemail',
])

const RESOLVED_CALL_OUTCOMES = new Set([
  'answered',
  'completed',
  'connected',
  'spoke-with-owner',
  'live',
])

const OPT_OUT_SMS_TYPES = new Set(['sms', 'sms_received', 'sms_inbound'])

function isContactOptOut(activity: ConversationHubActivity): boolean {
  if (!OPT_OUT_SMS_TYPES.has(activity.activity_type)) return false
  const message = activity.description?.toLowerCase().replace(/[^a-z\s']/g, ' ').replace(/\s+/g, ' ').trim() ?? ''
  return /^(stop|stopall|unsubscribe|quit|end)$/.test(message) ||
    /\b(stop calling|stop texting|stop messaging|do not call|don't call|remove me|take me off)\b/.test(message)
}

function normalizedMetadataValues(activity: ConversationHubActivity): string[] {
  const metadata = activity.metadata ?? {}
  return [
    metadata.outcome,
    metadata.dialStatus,
    metadata.disposition,
    metadata.status,
    metadata.callStatus,
  ]
    .map((value) => text(value)?.toLowerCase().replace(/[\s_]+/g, '-') ?? null)
    .filter((value): value is string => Boolean(value))
}

/**
 * An inbound communication only needs an agent response when the seller has
 * not already been served by that event. Calls are outcome-aware: a connected
 * call is resolved, while a missed call or voicemail remains actionable.
 */
export function inboundCommunicationNeedsReply(activity: ConversationHubActivity): boolean {
  if (getConversationDirection(activity) !== 'inbound') return false
  if (activity.activity_type === 'voicemail') return true
  if (activity.activity_type === 'missed_call') return true
  if (activity.activity_type !== 'call') return !isContactOptOut(activity)

  const outcomes = normalizedMetadataValues(activity)
  const description = activity.description?.toLowerCase() ?? ''
  if (outcomes.some((value) => OPEN_CALL_OUTCOMES.has(value))) return true
  if (/missed|no[ -]?answer|busy|voicemail|failed|cancel/.test(description)) return true
  const hasRecording = [
    activity.metadata?.recordingSid,
    activity.metadata?.recordingUrl,
    activity.metadata?.recording_url,
  ].some((value) => Boolean(text(value)))
  if (hasRecording || /call recording available/.test(description)) return false
  if (outcomes.some((value) => RESOLVED_CALL_OUTCOMES.has(value))) return false
  if (/connected live|answered|completed call/.test(description)) return false

  // Unknown inbound call outcomes stay visible until the result is known.
  return true
}

function latestFirst(a: ConversationHubActivity, b: ConversationHubActivity): number {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

export function conversationAttentionStateFromActivities(
  activities: ConversationHubActivity[],
): ConversationAttentionState {
  const sorted = [...activities].sort(latestFirst)
  const operatingState = sorted.find((activity) =>
    activity.activity_type === 'status_change' &&
    activity.metadata?.workflow_id === 'seller-form-intake',
  )
  const latestHubState = sorted.find((activity) =>
    activity.activity_type === 'status_change' &&
    ['mark_read', 'mark_unread'].includes(String(activity.metadata?.hub_action ?? '')),
  )
  const latestComm = sorted.find((activity) => getConversationDirection(activity) !== null)

  let attentionState: ConversationAttentionState =
    operatingState?.metadata?.conversation_attention === 'needs_reply'
      ? 'needs_reply'
      : 'resolved'

  if (latestComm) {
    attentionState = getConversationDirection(latestComm) === 'outbound'
      ? 'waiting_on_contact'
      : inboundCommunicationNeedsReply(latestComm)
        ? 'needs_reply'
        : 'resolved'
  }

  if (latestHubState && (!latestComm || new Date(latestHubState.created_at) > new Date(latestComm.created_at))) {
    attentionState = latestHubState.metadata?.hub_action === 'mark_unread' ? 'needs_reply' : 'resolved'
  }

  return attentionState
}

export function countConversationsNeedingReply(activities: ConversationHubActivity[]): number {
  return summarizeConversationAttention(activities).needsReply
}

export interface ConversationAttentionSummary {
  needsReply: number
  calls: number
  emails: number
  texts: number
  overdue: number
}

export function summarizeConversationAttention(
  activities: ConversationHubActivity[],
  now = new Date(),
): ConversationAttentionSummary {
  const activitiesByLead = new Map<string, ConversationHubActivity[]>()
  for (const activity of activities) {
    if (!activity.lead_id) continue
    const leadActivities = activitiesByLead.get(activity.lead_id) ?? []
    leadActivities.push(activity)
    activitiesByLead.set(activity.lead_id, leadActivities)
  }

  const summary: ConversationAttentionSummary = { needsReply: 0, calls: 0, emails: 0, texts: 0, overdue: 0 }
  for (const leadActivities of activitiesByLead.values()) {
    const sorted = [...leadActivities].sort(latestFirst)
    if (conversationAttentionStateFromActivities(sorted) === 'needs_reply') {
      summary.needsReply += 1
      const latestComm = sorted.find((activity) => getConversationDirection(activity) !== null)
      if (latestComm?.activity_type.includes('sms')) summary.texts += 1
      else if (latestComm?.activity_type.startsWith('email')) summary.emails += 1
      else if (latestComm && ['call', 'voicemail'].includes(latestComm.activity_type)) summary.calls += 1
    }

    const primaryTask = sorted.find((activity) =>
      activity.activity_type === 'task' &&
      activity.metadata?.primary_next_action === true &&
      (activity.metadata?.status === undefined || activity.metadata?.status === null || activity.metadata?.status === 'pending'),
    )
    const dueAt = text(primaryTask?.metadata?.due_date)
    if (dueAt && new Date(dueAt) < now) summary.overdue += 1
  }

  return summary
}

export function buildConversationHubThread(
  lead: ConversationHubLead,
  activities: ConversationHubActivity[],
  now = new Date(),
): ConversationHubThread {
  const sorted = [...activities].sort(latestFirst)
  const operatingState = sorted.find((activity) =>
    activity.activity_type === 'status_change' &&
    activity.metadata?.workflow_id === 'seller-form-intake',
  )
  const latestComm = sorted.find((activity) => getConversationDirection(activity) !== null)
  const attentionState = conversationAttentionStateFromActivities(sorted)

  const primaryTask = sorted.find((activity) =>
    activity.activity_type === 'task' &&
    activity.metadata?.primary_next_action === true &&
    (activity.metadata?.status === undefined || activity.metadata?.status === null || activity.metadata?.status === 'pending'),
  )
  const dueAt = text(primaryTask?.metadata?.due_date)
  const owner =
    text(lead.assigned_agent) ??
    text(primaryTask?.metadata?.assigned_to) ??
    text(operatingState?.metadata?.owner_name)

  return {
    ...lead,
    attentionState,
    owner,
    unread: attentionState === 'needs_reply',
    lastMessage: latestComm ? communicationActivitySummary(latestComm) : (
      attentionState === 'needs_reply' ? 'New seller needs a response' : 'No communication yet'
    ),
    lastActivityAt: sorted[0]?.created_at || lead.created_at,
    lastChannel: latestComm
      ? latestComm.activity_type.includes('sms')
        ? 'sms'
        : latestComm.activity_type === 'voicemail'
          ? 'voicemail'
          : latestComm.activity_type === 'email'
            ? 'email'
            : 'call'
      : null,
    lastCallOutcome: latestComm && ['call', 'missed_call', 'voicemail'].includes(latestComm.activity_type)
      ? getCallOutcomePresentation(latestComm)
      : null,
    primaryNextAction: primaryTask ? {
      id: primaryTask.id,
      title: primaryTask.description || 'Next action',
      dueAt,
      owner: text(primaryTask.metadata?.assigned_to) ?? owner,
      overdue: Boolean(dueAt && new Date(dueAt) < now),
    } : null,
  }
}

export function buildConversationHubThreads(
  leads: ConversationHubLead[],
  activities: ConversationHubActivity[],
  now = new Date(),
): ConversationHubThread[] {
  const byLead = new Map<string, ConversationHubActivity[]>()
  for (const activity of activities) {
    if (!activity.lead_id) continue
    const items = byLead.get(activity.lead_id) ?? []
    items.push(activity)
    byLead.set(activity.lead_id, items)
  }

  const attentionOrder: Record<ConversationAttentionState, number> = {
    needs_reply: 0,
    waiting_on_contact: 1,
    resolved: 2,
  }

  return leads
    .map((lead) => buildConversationHubThread(lead, byLead.get(lead.id) ?? [], now))
    .sort((a, b) =>
      attentionOrder[a.attentionState] - attentionOrder[b.attentionState] ||
      new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
    )
}
