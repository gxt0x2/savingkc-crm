import {
  playableRecordingUrl,
  readRecordingDuration,
  readRecordingSid,
  record,
  text,
} from '@/lib/marketing/call-recordings'

export type LeadRecordingActivity = {
  activity_type: string
  created_at: string
  metadata: Record<string, unknown> | null
}

export type ManifestRecordingTranscript = {
  date: string
  recordingUrl?: string
}

function normalizeStoredRecordingUrl(raw: unknown): string | null {
  const value = text(raw)
  if (!value) return null

  const protectedUrl = playableRecordingUrl({ recordingUrl: value })
  if (protectedUrl) return protectedUrl

  // Manifest recordings may be stored in another authenticated media service.
  // Preserve those URLs, while Twilio URLs are always converted to our proxy.
  if (value.startsWith('/')) return value
  if (/^https:\/\//i.test(value)) {
    try {
      const parsed = new URL(value)
      return parsed.hostname === 'api.twilio.com' ? null : value
    } catch {
      return null
    }
  }
  return null
}

function timestamp(value: string): number | null {
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeLeadRecordingActivities<T extends LeadRecordingActivity>(
  activities: T[],
  transcripts: ManifestRecordingTranscript[],
): T[] {
  const transcriptLookup = transcripts
    .map((transcript) => {
      const url = normalizeStoredRecordingUrl(transcript.recordingUrl)
      const sidMatch = url?.match(/\/api\/recordings\/(RE[A-Za-z0-9]+)/i)
      return {
        timestamp: timestamp(transcript.date),
        url,
        sid: sidMatch?.[1] ?? null,
      }
    })
    .filter((transcript): transcript is { timestamp: number; url: string; sid: string | null } => (
      transcript.timestamp != null && transcript.url != null
    ))

  function transcriptUrlFor(activity: T, recordingSid: string): string | null {
    if (recordingSid) {
      const exact = transcriptLookup.find((transcript) => transcript.sid === recordingSid)
      if (exact) return exact.url
    }

    const activityTimestamp = timestamp(activity.created_at)
    if (activityTimestamp == null) return null

    let nearest: { distance: number; url: string } | null = null
    for (const transcript of transcriptLookup) {
      const distance = Math.abs(transcript.timestamp - activityTimestamp)
      if (distance > 30 * 60_000) continue
      if (!nearest || distance < nearest.distance) nearest = { distance, url: transcript.url }
    }
    if (nearest) return nearest.url

    const metadata = record(activity.metadata)
    const callSid = text(metadata.callSid) || text(metadata.CallSid) || text(metadata.call_sid)
    if (callSid && transcriptLookup.length === 1) return transcriptLookup[0].url
    return null
  }

  return activities.map((activity) => {
    if (activity.activity_type !== 'call' && activity.activity_type !== 'voicemail') return activity

    const metadata = record(activity.metadata)
    const fromMetadata = playableRecordingUrl(metadata)
      ?? normalizeStoredRecordingUrl(metadata.recordingUrl ?? metadata.recording_url ?? metadata.RecordingUrl)
    const recordingSid = readRecordingSid(metadata)
    const recordingUrl = fromMetadata ?? transcriptUrlFor(activity, recordingSid)
    const recordingDuration = readRecordingDuration(metadata)

    if (!recordingUrl && recordingDuration === 0) return activity

    return {
      ...activity,
      metadata: {
        ...metadata,
        ...(recordingUrl && { recordingUrl }),
        ...(recordingDuration > 0 && { recordingDuration }),
      },
    }
  })
}
