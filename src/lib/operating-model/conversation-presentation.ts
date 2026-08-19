import { isAllowedSmsSender, normalizeTwilioNumber } from '@/lib/twilio-numbers'

export type ConversationDirection = 'inbound' | 'outbound' | null
export type CallOutcomeTone = 'positive' | 'attention' | 'negative' | 'neutral'
export type CallOutcomeKey =
  | 'connected'
  | 'missed'
  | 'no_answer'
  | 'busy'
  | 'voicemail'
  | 'failed'
  | 'routing'
  | 'attempted'
  | 'pending'

export interface ConversationActivityLike {
  activity_type: string
  description: string | null
  metadata: Record<string, unknown> | null
}

export interface CallOutcomePresentation {
  key: CallOutcomeKey
  label: string
  icon: string
  tone: CallOutcomeTone
}

export interface CallParties {
  from: string | null
  to: string | null
}

const SMS_ACTIVITY_TYPES = new Set([
  'sms',
  'sms_sent',
  'sms_received',
  'sms_inbound',
  'sms_outbound',
])

const COMM_TYPES = new Set([
  'call',
  ...SMS_ACTIVITY_TYPES,
  'email',
  'voicemail',
])

export function isSmsConversationActivityType(activityType: string): boolean {
  return SMS_ACTIVITY_TYPES.has(activityType)
}

export function getEligibleSmsReplySender(activity: ConversationActivityLike): string | undefined {
  if (!isSmsConversationActivityType(activity.activity_type)) return undefined

  const direction = getConversationDirection(activity)
  const candidate = direction === 'inbound'
    ? activity.metadata?.to
    : activity.metadata?.from ?? activity.metadata?.fromPhone
  const normalizedSender = normalizeTwilioNumber(typeof candidate === 'string' ? candidate : undefined)

  return normalizedSender && isAllowedSmsSender(normalizedSender, 'conversation')
    ? normalizedSender
    : undefined
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalized(value: unknown): string {
  return text(value)?.toLowerCase().replace(/[\s-]+/g, '_') ?? ''
}

export function getConversationDirection(activity: ConversationActivityLike): ConversationDirection {
  if (!COMM_TYPES.has(activity.activity_type)) return null

  const raw = normalized(activity.metadata?.direction)
  if (raw === 'inbound' || raw === 'received' || raw === 'in') return 'inbound'
  if (raw === 'outbound' || raw === 'sent' || raw === 'out') return 'outbound'
  if (activity.activity_type === 'sms_received' || activity.activity_type === 'sms_inbound' || activity.activity_type === 'voicemail') {
    return 'inbound'
  }
  return 'outbound'
}

function outcomeCandidates(activity: ConversationActivityLike): string[] {
  const metadata = activity.metadata ?? {}
  return [
    metadata.outcome,
    metadata.disposition,
    metadata.dialStatus,
    metadata.callStatus,
    metadata.status,
  ].map(normalized).filter(Boolean)
}

function hasAny(values: string[], candidates: string[]): boolean {
  return values.some((value) => candidates.includes(value))
}

/**
 * Convert mixed Twilio/dialer metadata into one outcome agents can act on.
 * A raw IVR arrival is a routing event, not a missed call; the later dial
 * result supplies the final connected/missed outcome.
 */
export function getCallOutcomePresentation(activity: ConversationActivityLike): CallOutcomePresentation {
  const metadata = activity.metadata ?? {}
  const outcomes = outcomeCandidates(activity)
  const description = activity.description?.toLowerCase() ?? ''
  const sourceTag = normalized(metadata.tag)

  if (
    (sourceTag === 'ivr_no_input' && outcomes.length === 0) ||
    /routing to (agents|team)/.test(description)
  ) {
    return { key: 'routing', label: 'Routing to Acquisitions', icon: 'groups', tone: 'attention' }
  }

  if (
    hasAny(outcomes, ['connected', 'answered', 'completed', 'spoke_with_owner', 'live']) ||
    /connected live|answered|completed call|spoke with/.test(description) ||
    Boolean(text(metadata.recordingSid) || text(metadata.recordingUrl) || text(metadata.recording_url))
  ) {
    return { key: 'connected', label: 'Connected', icon: 'phone_in_talk', tone: 'positive' }
  }

  if (activity.activity_type === 'voicemail' || hasAny(outcomes, ['voicemail']) || /voicemail/.test(description)) {
    return { key: 'voicemail', label: 'Voicemail', icon: 'voicemail', tone: 'attention' }
  }

  if (hasAny(outcomes, ['no_answer', 'not_answered']) || /no[ -]?answer|not answered/.test(description)) {
    return { key: 'no_answer', label: 'No answer', icon: 'phone_missed', tone: 'negative' }
  }

  if (hasAny(outcomes, ['busy']) || /\bbusy\b/.test(description)) {
    return { key: 'busy', label: 'Line busy', icon: 'phone_paused', tone: 'attention' }
  }

  if (hasAny(outcomes, ['missed']) || /\bmissed\b/.test(description)) {
    return { key: 'missed', label: 'Missed', icon: 'phone_missed', tone: 'negative' }
  }

  if (
    hasAny(outcomes, ['failed', 'canceled', 'cancelled', 'bad_number', 'disconnected']) ||
    /failed|cancelled|canceled|bad number|disconnected/.test(description)
  ) {
    return { key: 'failed', label: 'Call failed', icon: 'error', tone: 'negative' }
  }

  if (getConversationDirection(activity) === 'outbound') {
    return { key: 'attempted', label: 'Attempted', icon: 'call_made', tone: 'neutral' }
  }

  return { key: 'pending', label: 'Outcome pending', icon: 'schedule', tone: 'neutral' }
}

export function getCallParties(
  activity: ConversationActivityLike,
  fallback: { leadPhone?: string | null; teamPhone?: string | null } = {},
): CallParties {
  const metadata = activity.metadata ?? {}
  const direction = getConversationDirection(activity)
  const explicitFrom = text(metadata.from) ?? text(metadata.fromPhone) ?? text(metadata.caller)
  const explicitTo = text(metadata.to) ?? text(metadata.calledNumber) ?? text(metadata.toPhone)

  if (direction === 'inbound') {
    return {
      from: explicitFrom ?? fallback.leadPhone ?? null,
      to: explicitTo ?? fallback.teamPhone ?? null,
    }
  }

  return {
    from: explicitFrom ?? fallback.teamPhone ?? null,
    to: explicitTo ?? fallback.leadPhone ?? null,
  }
}

export function communicationActivitySummary(activity: ConversationActivityLike): string {
  const direction = getConversationDirection(activity)
  if (activity.activity_type === 'call' || activity.activity_type === 'voicemail') {
    const outcome = getCallOutcomePresentation(activity)
    const directionLabel = direction === 'inbound' ? 'Inbound' : 'Outbound'
    const channel = activity.activity_type === 'voicemail' ? 'voicemail' : 'call'
    return `${directionLabel} ${channel} · ${outcome.label}`
  }
  return activity.description?.trim() || 'Communication activity'
}
