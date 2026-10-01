const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const MOJO_RECORDING_BUCKET = 'mojo-call-recordings'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Only canonical copied Mojo evidence can be advertised as mobile-playable. */
export function mojoRecordingEventId(metadata: Record<string, unknown>): string | null {
  const storedEventId = text(metadata.event_id) || text(metadata.eventId)
  const storedUrl = text(metadata.recordingUrl) || text(metadata.recording_url)
  const urlEventId = /^\/api\/recordings\/mojo\/([0-9a-f-]+)$/i.exec(storedUrl)?.[1] || ''
  const eventId = storedEventId || urlEventId
  if (!UUID_PATTERN.test(eventId) || (urlEventId && urlEventId !== eventId)) return null
  const storagePath = text(metadata.recording_storage_path) || text(metadata.recordingStoragePath)
  return storagePath === `events/${eventId}.mp3` ? eventId : null
}

export function mojoRecordingStoragePath(eventId: string, value: unknown): string | null {
  return UUID_PATTERN.test(eventId) && text(value) === `events/${eventId}.mp3`
    ? `events/${eventId}.mp3` : null
}

export function mobileRecordingUrl(activityId: string, metadata: Record<string, unknown>, accountSid: string | undefined, twilioSid: (metadata: Record<string, unknown>, accountSid: string | undefined) => string | null): string | null {
  if (!UUID_PATTERN.test(activityId)) return null
  const hasProtectedSource = Boolean(twilioSid(metadata, accountSid) || mojoRecordingEventId(metadata))
  return hasProtectedSource ? `/api/mobile/v1/calls/${activityId}/recording` : null
}
