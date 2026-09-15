import type { ActivityType } from '@/types'

export interface ActivityFeedItem {
  id: string
  type: ActivityType
  title: string
  content?: string
  timestamp: string
  statusBadge?: string
  dispositionLabel?: string
  dispositionTone?: 'positive' | 'neutral' | 'negative'
  direction?: 'inbound' | 'outbound'
  link?: string
  linkLabel?: string
  recordingUrl?: string
  recordingSid?: string
  recordingDuration?: number
  rawType?: string
  agentName?: string
  metadata?: Record<string, unknown>
  callSummary?: string
  callTranscript?: string
}

const CALL_ID_FIELDS = [
  'callSid',
  'CallSid',
  'dialCallSid',
  'DialCallSid',
  'parentCallSid',
  'ParentCallSid',
  'triggerCallSid',
  'relatedCallSid',
  'recordingSid',
  'RecordingSid',
] as const

const CALL_LEG_ID_FIELDS = CALL_ID_FIELDS.filter((key) => (
  key !== 'recordingSid' && key !== 'RecordingSid'
))

const DUPLICATE_CALL_WINDOW_MS = 90_000
const CALL_NOTE_GRACE_MS = 2 * 60_000

function rawType(item: ActivityFeedItem): string {
  return item.rawType || item.type
}

function metadataText(item: ActivityFeedItem, key: string): string | null {
  const value = item.metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function timestampMs(item: ActivityFeedItem): number | null {
  const value = new Date(item.timestamp).getTime()
  return Number.isFinite(value) ? value : null
}

function normalizedPhone(item: ActivityFeedItem): string | null {
  const direction = item.direction
  const candidates = direction === 'inbound'
    ? ['from', 'phone', 'to']
    : ['to', 'phone', 'from']

  for (const key of candidates) {
    const value = metadataText(item, key)
    if (!value) continue
    const digits = value.replace(/\D/g, '')
    if (digits.length >= 10) return digits.slice(-10)
  }
  return null
}

function callIds(item: ActivityFeedItem, fields: readonly string[] = CALL_ID_FIELDS): Set<string> {
  const ids = new Set<string>()
  for (const key of fields) {
    const value = metadataText(item, key)
    if (value) ids.add(value)
  }
  return ids
}

function hasSharedCallId(a: ActivityFeedItem, b: ActivityFeedItem): boolean {
  const aIds = callIds(a)
  if (aIds.size === 0) return false
  const bIds = callIds(b)
  for (const id of aIds) {
    if (bIds.has(id)) return true
  }
  return false
}

function isRecordingOnly(item: ActivityFeedItem): boolean {
  const source = metadataText(item, 'source')?.toLowerCase()
  return item.title.toLowerCase() === 'call recording'
    || source === 'twilio_recording_callback'
    || source === 'recording_activity_backfill'
}

function isInitiatedCall(item: ActivityFeedItem): boolean {
  if (rawType(item) !== 'call') return false
  const status = metadataText(item, 'status')?.toLowerCase()
  const event = metadataText(item, 'event')?.toLowerCase()
  return status === 'initiated' || event === 'started'
}

function isCallQualityMilestone(item: ActivityFeedItem): boolean {
  return rawType(item) === 'status_change'
    && /^call quality milestone:/i.test(item.content?.trim() || '')
}

function secondsFromBadge(label: string | undefined): number | null {
  if (!label) return null
  const clock = label.match(/^(\d+):(\d{2})$/)
  if (clock) return (Number(clock[1]) * 60) + Number(clock[2])

  const minutes = label.match(/^(\d+)\s*min(?:ute)?s?(?:\s+(\d+)\s*sec(?:ond)?s?)?$/i)
  if (minutes) return (Number(minutes[1]) * 60) + Number(minutes[2] || 0)

  const seconds = label.match(/^(\d+)\s*sec(?:ond)?s?$/i)
  return seconds ? Number(seconds[1]) : null
}

function itemDurationSeconds(item: ActivityFeedItem): number | null {
  const values = [
    item.recordingDuration,
    item.metadata?.duration,
    item.metadata?.recordingDuration,
    item.metadata?.RecordingDuration,
    item.metadata?.dialCallDuration,
  ]
  for (const value of values) {
    const number = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(number) && number > 0) return Math.round(number)
  }
  return secondsFromBadge(item.statusBadge)
}

export function formatCallDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(totalSeconds / 60)
  const remainder = totalSeconds % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function callsBelongTogether(a: ActivityFeedItem, b: ActivityFeedItem): boolean {
  if (hasSharedCallId(a, b)) return true

  const aLegIds = callIds(a, CALL_LEG_ID_FIELDS)
  const bLegIds = callIds(b, CALL_LEG_ID_FIELDS)
  if (aLegIds.size > 0 && bLegIds.size > 0) return false

  const aTime = timestampMs(a)
  const bTime = timestampMs(b)
  if (aTime == null || bTime == null || Math.abs(aTime - bTime) > DUPLICATE_CALL_WINDOW_MS) return false

  if (a.direction && b.direction && a.direction !== b.direction) return false

  const aPhone = normalizedPhone(a)
  const bPhone = normalizedPhone(b)
  if (aPhone && bPhone && aPhone !== bPhone) return false

  return true
}

function callScore(item: ActivityFeedItem): number {
  const status = metadataText(item, 'status')?.toLowerCase()
  let score = 0
  if (item.dispositionLabel) score += 8
  if (item.direction) score += 4
  if (item.content) score += 3
  if (itemDurationSeconds(item)) score += 3
  if (status && status !== 'initiated') score += 2
  if (item.agentName && item.agentName !== 'System') score += 1
  if (isRecordingOnly(item)) score -= 8
  if (/needs disposition/i.test(item.statusBadge || '')) score -= 2
  return score
}

function mergeCallGroup(group: ActivityFeedItem[]): ActivityFeedItem {
  const ranked = [...group].sort((a, b) => callScore(b) - callScore(a))
  const base = ranked[0]
  const direction = ranked.find((item) => item.direction)?.direction
  const disposition = ranked.find((item) => item.dispositionLabel)
  const recording = ranked.find((item) => item.recordingUrl)
  const content = ranked.find((item) => item.content)?.content
  const agent = ranked.find((item) => item.agentName && item.agentName !== 'System')?.agentName
  const durations = ranked
    .map(itemDurationSeconds)
    .filter((value): value is number => value != null)
  const recordingDuration = recording ? itemDurationSeconds(recording) : null
  // The media callback/player duration reflects the actual recording. Provider
  // call-leg duration can disagree (for example 146 seconds vs a 12:38 file),
  // so prefer the recording value whenever one is available.
  const duration = recordingDuration
    ?? itemDurationSeconds(base)
    ?? (durations.length > 0 ? Math.max(...durations) : null)
  const fallbackStatus = ranked.find((item) => item.statusBadge && itemDurationSeconds(item) == null)?.statusBadge

  return {
    ...base,
    title: direction === 'inbound' ? 'Inbound call' : direction === 'outbound' ? 'Outbound call' : 'Call',
    content,
    direction,
    dispositionLabel: disposition?.dispositionLabel,
    dispositionTone: disposition?.dispositionTone,
    statusBadge: duration != null ? formatCallDuration(duration) : fallbackStatus,
    recordingUrl: recording?.recordingUrl,
    recordingSid: recording?.recordingSid,
    recordingDuration: recordingDuration || duration || undefined,
    agentName: agent,
  }
}

function callNoteKind(item: ActivityFeedItem): 'summary' | 'transcript' | null {
  if (rawType(item) !== 'note') return null
  const content = item.content?.trim() || ''
  if (/^AI Call Analysis:/i.test(content)) return 'summary'
  if (/^Call transcript:/i.test(content)) return 'transcript'
  return null
}

function stripCallNotePrefix(content: string, kind: 'summary' | 'transcript'): string {
  return content.replace(kind === 'summary' ? /^AI Call Analysis:\s*/i : /^Call transcript:\s*/i, '').trim()
}

function closestCallForNote(note: ActivityFeedItem, calls: ActivityFeedItem[]): ActivityFeedItem | null {
  const noteTime = timestampMs(note)
  if (noteTime == null) return null

  let closest: { item: ActivityFeedItem; distance: number } | null = null
  for (const call of calls) {
    const callTime = timestampMs(call)
    if (callTime == null) continue
    const durationMs = (itemDurationSeconds(call) || 0) * 1000
    if (noteTime < callTime - CALL_NOTE_GRACE_MS) continue
    if (noteTime > callTime + durationMs + CALL_NOTE_GRACE_MS) continue
    const distance = Math.min(
      Math.abs(noteTime - callTime),
      Math.abs(noteTime - (callTime + durationMs)),
    )
    if (!closest || distance < closest.distance) closest = { item: call, distance }
  }
  return closest?.item || null
}

/**
 * Converts the append-only activity audit trail into an agent-facing timeline.
 * No source rows are deleted or changed: initiated legs, recording callbacks,
 * duplicate provider rows, call milestones, and generated call notes are only
 * folded together for display.
 */
export function simplifyActivityFeedItems(activities: ActivityFeedItem[]): ActivityFeedItem[] {
  const useful = activities.filter((item) => !isInitiatedCall(item) && !isCallQualityMilestone(item))
  const callGroups: ActivityFeedItem[][] = []

  for (const call of useful.filter((item) => rawType(item) === 'call')) {
    const group = callGroups.find((candidate) => candidate.some((item) => callsBelongTogether(item, call)))
    if (group) group.push(call)
    else callGroups.push([call])
  }

  const calls = callGroups.map(mergeCallGroup)
  const normalItems: ActivityFeedItem[] = []

  for (const item of useful) {
    if (rawType(item) === 'call') continue
    const kind = callNoteKind(item)
    if (!kind || !item.content) {
      normalItems.push(item)
      continue
    }

    const call = closestCallForNote(item, calls)
    if (!call) {
      normalItems.push(item)
      continue
    }

    const detail = stripCallNotePrefix(item.content, kind)
    if (kind === 'summary') call.callSummary = detail
    else call.callTranscript = detail
  }

  return [...calls, ...normalItems].sort((a, b) => {
    const aTime = timestampMs(a) || 0
    const bTime = timestampMs(b) || 0
    return bTime - aTime
  })
}
