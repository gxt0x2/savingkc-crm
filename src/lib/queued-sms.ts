export const QUEUED_SMS_CONTRACT = 'scheduled_sms_v2'
export const QUEUED_SMS_VERSION = 2

type ExtraMetadata = Record<string, unknown>

interface QueuedSmsMetadataParams {
  to: string
  from: string
  body: string
  source: string
  dueDate?: string | Date
  template?: string
  extra?: ExtraMetadata
}

function toIsoDate(value: string | Date | undefined): string {
  if (!value) return new Date().toISOString()
  return value instanceof Date ? value.toISOString() : value
}

export function buildQueuedSmsMetadata({
  to,
  from,
  body,
  source,
  dueDate,
  template,
  extra,
}: QueuedSmsMetadataParams): ExtraMetadata {
  const dueDateIso = toIsoDate(dueDate)

  return {
    ...extra,
    queue_contract: QUEUED_SMS_CONTRACT,
    queue_version: QUEUED_SMS_VERSION,
    channel: 'sms',
    direction: 'outbound',
    to,
    from,
    message: body,
    body,
    status: 'pending',
    due_date: dueDateIso,
    send_at: dueDateIso,
    queued_at: new Date().toISOString(),
    source,
    ...(template ? { template } : {}),
  }
}
