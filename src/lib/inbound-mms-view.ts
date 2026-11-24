export const INBOUND_MMS_BUCKET = 'inbound-mms'
export const PHOTO_UNAVAILABLE_CAPTION = 'Photo unavailable'

const INBOUND_DIRECTIONS = new Set(['received', 'inbound', 'in'])
const MMS_MESSAGE_SID = /^MM[0-9a-f]{32}$/i

export interface ConversationMmsView {
  src: string
  contentType: string
  label: string
}

export function inboundSmsDisplayBody(body: string | null | undefined, mediaCount: number): string {
  const text = (body ?? '').trim()
  if (text) return text
  if (mediaCount === 1) return 'Sent a photo'
  if (mediaCount > 1) return `Sent ${mediaCount} photos`
  return ''
}

/** Storage paths written by the inbound MMS capture. Rejects traversal and foreign buckets. */
export function isSafeInboundMmsPath(path: string): boolean {
  return /^(?:SM|MM)[0-9a-f]{32}\/\d{1,2}-[A-Za-z0-9._-]{1,80}$/i.test(path)
}

export function conversationMmsViews(metadata: Record<string, unknown> | null | undefined): ConversationMmsView[] {
  if (!metadata || !Array.isArray(metadata.mms)) return []
  return metadata.mms.flatMap((item, position) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (row.storage_bucket !== INBOUND_MMS_BUCKET || typeof row.storage_path !== 'string') return []
    if (!isSafeInboundMmsPath(row.storage_path)) return []
    const contentType = typeof row.content_type === 'string' && row.content_type
      ? row.content_type
      : 'application/octet-stream'
    const label = contentType.startsWith('image/') ? `Photo ${position + 1}` : `Attachment ${position + 1}`
    return [{
      src: `/api/conversations/mms?path=${encodeURIComponent(row.storage_path)}`,
      contentType,
      label,
    }]
  })
}

/**
 * Historical inbound MMS rows have an MM sid and an empty body. Stored media
 * keeps the #802 caption. A sid whose media Twilio no longer has gets an
 * explicit caption instead of an empty bubble.
 */
export function presentConversationMmsActivity<T extends {
  activity_type?: string
  description?: string | null
  metadata?: unknown
}>(activity: T): T {
  const activityType = activity.activity_type ?? 'sms'
  if (activityType !== 'sms' && !activityType.startsWith('sms_')) return activity
  const metadata = activity.metadata && typeof activity.metadata === 'object' && !Array.isArray(activity.metadata)
    ? activity.metadata as Record<string, unknown>
    : null
  if (!metadata) return activity
  const sid = typeof metadata.message_sid === 'string' ? metadata.message_sid.trim() : ''
  if (!MMS_MESSAGE_SID.test(sid)) return activity
  const direction = typeof metadata.direction === 'string' ? metadata.direction.trim().toLowerCase() : ''
  if (direction && !INBOUND_DIRECTIONS.has(direction)) return activity
  if ((activity.description ?? '').trim()) return activity
  const mediaCount = conversationMmsViews(metadata).length
  const description = mediaCount > 0 ? inboundSmsDisplayBody('', mediaCount) : PHOTO_UNAVAILABLE_CAPTION
  return { ...activity, description }
}
