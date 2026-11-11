export const INBOUND_MMS_BUCKET = 'inbound-mms'

export interface ConversationMmsView {
  src: string
  contentType: string
  label: string
}

/** Storage paths written by the inbound MMS capture. Rejects traversal and foreign buckets. */
export function isSafeInboundMmsPath(path: string): boolean {
  return /^SM[0-9a-f]{32}\/\d{1,2}-[A-Za-z0-9._-]{1,80}$/i.test(path)
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
