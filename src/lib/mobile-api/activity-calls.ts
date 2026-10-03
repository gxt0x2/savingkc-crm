import { mobileRecordingUrl } from '@/lib/mobile-api/mojo-recording'
import { twilioRecordingSid } from '@/lib/mobile-api/twilio-recording'
import { buildMobileRecentCalls, groupRecentCallRows, type RecentCallActivityRow } from '@/lib/mobile-api/recent-calls'

const CALL_TYPES = new Set(['call', 'missed_call', 'voicemail'])
const RECORDING_URL_KEYS = ['recordingUrl', 'recording_url', 'RecordingUrl', 'recording', 'recordingSourceUrl']

/** Both profile and conversation hydration expose the same authorized playback contract.
 * Recording callbacks are asset evidence for a durable call, never another missed call.
 */
export function normalizeMobileCallActivities<T extends Omit<RecentCallActivityRow, 'metadata'> & { metadata?: unknown }>(activities: T[]): T[] {
  const calls: RecentCallActivityRow[] = activities.filter((activity) => CALL_TYPES.has(activity.activity_type)).map((activity) => ({
    ...activity, metadata: activity.metadata && typeof activity.metadata === 'object' && !Array.isArray(activity.metadata)
      ? activity.metadata as Record<string, unknown> : {},
  }))
  const normalized = groupRecentCallRows(calls).flatMap((group) => {
    // Legacy callbacks defaulted an absent From to inbound. Without an actual
    // call anchor, there is no evidence for its direction or disposition.
    if (group.every((row) => row.metadata?.source === 'twilio_recording_callback')) return []
    const item = buildMobileRecentCalls(group, 1)[0]
    if (!item) return []
    const selected = activities.find((row) => row.id === item.id) as T
    // These rows are already authorized by the enclosing lead read. Its narrow
    // SELECT deliberately omits lead_id, unlike the account-scoped recent feed.
    const recordingUrl = group.map((row) => mobileRecordingUrl(row.id, row.metadata ?? {}, process.env.TWILIO_ACCOUNT_SID?.trim(), twilioRecordingSid)).find(Boolean)
    const metadata = { ...(group.find((row) => row.id === item.id)?.metadata ?? {}) }
    for (const key of RECORDING_URL_KEYS) delete metadata[key]
    return [{ ...selected, metadata: {
      ...metadata,
      direction: item.direction,
      outcome: item.outcome,
      duration: item.durationSeconds,
      phone: item.phone,
      ...(item.inboundRoute ? { inboundRoute: item.inboundRoute } : {}),
      ...(recordingUrl ? { recordingUrl } : {}),
      ...(item.voicemailReceived ? { voicemailReceived: true } : {}),
    } } as T]
  })
  return [...activities.filter((activity) => !CALL_TYPES.has(activity.activity_type)), ...normalized]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}
