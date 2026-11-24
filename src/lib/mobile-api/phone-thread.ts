import { isMobileCustomerActivity } from '@/lib/mobile-api/customer-communication'
import { getConversationDirection } from '@/lib/operating-model/conversation-presentation'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

export const MOBILE_CONVERSATION_ACTIVITY_TYPES = [
  'call', 'missed_call', 'sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound',
  'email', 'email_sent', 'email_received', 'voicemail', 'note',
] as const

/** `unmatched:+E164` and `phone:+E164` are one phone thread. Returns the E.164 number. */
export function unmatchedPhoneFromThreadId(id: string): string | null {
  let value = id.trim()
  try {
    const decoded = decodeURIComponent(value)
    if (decoded) value = decoded
  } catch {
    // Keep the raw id when it is not percent-encoded.
  }
  const separator = value.indexOf(':')
  if (separator < 1) return null
  const prefix = value.slice(0, separator).toLowerCase()
  if (prefix !== 'unmatched' && prefix !== 'phone') return null
  return normalizePhoneToE164(value.slice(separator + 1))
}

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/** Customer side of a projected conversation row. Internal coordination has no direction. */
export function phoneThreadParticipant(activity: {
  activity_type: string
  description?: string | null
  metadata?: unknown
}): string | null {
  if (!isMobileCustomerActivity(activity)) return null
  const metadata = metadataRecord(activity.metadata)
  const direction = getConversationDirection({
    activity_type: activity.activity_type,
    description: activity.description ?? null,
    metadata,
  })
  const raw = direction === 'inbound'
    ? text(metadata.from) ?? text(metadata.fromPhone) ?? text(metadata.caller) ?? text(metadata.phone)
    : direction === 'outbound'
      ? text(metadata.to) ?? text(metadata.toPhone) ?? text(metadata.calledNumber) ?? text(metadata.phone)
      : null
  return normalizePhoneToE164(raw)
}

export function activityBelongsToPhoneThread(activity: {
  activity_type: string
  description?: string | null
  metadata?: unknown
}, phone: string): boolean {
  return phoneThreadParticipant(activity) === phone
}
