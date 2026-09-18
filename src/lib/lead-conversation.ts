import { formatCallDuration } from '@/lib/activity-feed-simplify'

export type LeadCommunicationFilter = 'all' | 'call' | 'sms' | 'email' | 'note' | 'voicemail'

export interface LeadConversationActivity {
  id: string
  activity_type: string
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  agent?: string | null
  callSummary?: string
  callTranscript?: string
  recordingActivityId?: string
  collapsedActivityIds?: string[]
}

type NormalizedActivity<T extends LeadConversationActivity> = T & {
  callSummary?: string
  callTranscript?: string
  recordingActivityId?: string
  collapsedActivityIds?: string[]
}

const COMMUNICATION_TYPES = new Set(['sms', 'call', 'voicemail', 'email', 'note', 'agent_note'])
const CALL_ID_FIELDS = [
  'callSid',
  'CallSid',
  'call_sid',
  'dialCallSid',
  'DialCallSid',
  'parentCallSid',
  'ParentCallSid',
  'triggerCallSid',
  'relatedCallSid',
  'recordingSid',
  'RecordingSid',
] as const
const CALL_LEG_ID_FIELDS = CALL_ID_FIELDS.filter((key) => key !== 'recordingSid' && key !== 'RecordingSid')
const RECORDING_FIELDS = [
  'recordingSid',
  'RecordingSid',
  'recordingUrl',
  'recording_url',
  'RecordingUrl',
  'recordingDuration',
  'RecordingDuration',
  'duration_seconds',
] as const
const DUPLICATE_CALL_WINDOW_MS = 2 * 60_000
const CALL_NOTE_WINDOW_MS = 5 * 60_000
const FAILURE_OUTCOMES = new Set(['no_answer', 'busy', 'disconnected', 'failed'])

function timestamp(value: string): number {
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function metadataText(activity: LeadConversationActivity, key: string): string | null {
  const value = activity.metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function metadataNumber(activity: LeadConversationActivity, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = activity.metadata?.[key]
    const parsed = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
  }
  return null
}

function normalizedDirection(activity: LeadConversationActivity): 'inbound' | 'outbound' | null {
  const direction = metadataText(activity, 'direction')?.toLowerCase()
  if (direction === 'inbound' || direction === 'outbound') return direction
  const description = activity.description?.trim() || ''
  if (/^(?:direct\s+)?inbound\b/i.test(description)) return 'inbound'
  if (/^(?:mojo\s+)?outbound\b|^call to\b/i.test(description)) return 'outbound'
  return null
}

function normalizedPhone(activity: LeadConversationActivity): string | null {
  const direction = normalizedDirection(activity)
  const candidates = direction === 'inbound'
    ? ['from', 'phone', 'to']
    : ['to', 'phone', 'from']

  for (const key of candidates) {
    const value = metadataText(activity, key)
    if (!value) continue
    const digits = value.replace(/\D/g, '')
    if (digits.length >= 10) return digits.slice(-10)
  }
  return null
}

function callIds(activity: LeadConversationActivity, fields: readonly string[] = CALL_ID_FIELDS): Set<string> {
  const ids = new Set<string>()
  for (const key of fields) {
    const value = metadataText(activity, key)
    if (value) ids.add(value)
  }
  return ids
}

function hasSharedCallId(left: LeadConversationActivity, right: LeadConversationActivity): boolean {
  const leftIds = callIds(left)
  if (leftIds.size === 0) return false
  const rightIds = callIds(right)
  for (const id of leftIds) {
    if (rightIds.has(id)) return true
  }
  return false
}

function hasRecording(activity: LeadConversationActivity): boolean {
  return Boolean(
    metadataText(activity, 'recordingSid')
    || metadataText(activity, 'RecordingSid')
    || metadataText(activity, 'recordingUrl')
    || metadataText(activity, 'recording_url')
    || metadataText(activity, 'RecordingUrl'),
  )
}

function isRecordingOnly(activity: LeadConversationActivity): boolean {
  const source = metadataText(activity, 'source')?.toLowerCase()
  const description = activity.description?.trim() || ''
  return source === 'twilio_recording_callback'
    || source === 'recording_activity_backfill'
    || /^call recording available$/i.test(description)
}

function callSubject(activity: LeadConversationActivity): string | null {
  const description = activity.description?.trim() || ''
  const match = description.match(/(?:outbound call to|inbound call from|direct inbound call from|call to)\s+(.+?)(?:\s*[—-]\s*|$)/i)
  return match?.[1]?.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim() || null
}

type CallOutcome = 'appointment_set' | 'connected' | 'left_voicemail' | 'no_answer' | 'busy' | 'disconnected' | 'failed' | 'attempted'

function callOutcome(activity: LeadConversationActivity): CallOutcome | null {
  const values = [
    metadataText(activity, 'disposition'),
    metadataText(activity, 'status'),
    activity.description,
  ].filter(Boolean).join(' ').toLowerCase()

  if (/appointment[_\s-]?set/.test(values)) return 'appointment_set'
  if (/left[_\s-]?(?:vm|voicemail)/.test(values)) return 'left_voicemail'
  if (/no[_\s-]?answer/.test(values)) return 'no_answer'
  if (/\bbusy\b/.test(values)) return 'busy'
  if (/disconnect/.test(values)) return 'disconnected'
  if (/\bfailed\b|\bcanceled\b/.test(values)) return 'failed'
  if (/connected live|\bcompleted\b|\banswered\b|\binterested\b/.test(values)) return 'connected'
  if (/\battempted\b|\binitiated\b|\bstarted\b/.test(values)) return 'attempted'
  return null
}

function callsBelongTogether(left: LeadConversationActivity, right: LeadConversationActivity): boolean {
  if (hasSharedCallId(left, right)) return true

  const leftLegIds = callIds(left, CALL_LEG_ID_FIELDS)
  const rightLegIds = callIds(right, CALL_LEG_ID_FIELDS)
  if (leftLegIds.size > 0 && rightLegIds.size > 0) return false

  if (Math.abs(timestamp(left.created_at) - timestamp(right.created_at)) > DUPLICATE_CALL_WINDOW_MS) return false

  const leftDirection = normalizedDirection(left)
  const rightDirection = normalizedDirection(right)
  if (
    leftDirection
    && rightDirection
    && leftDirection !== rightDirection
    && !isRecordingOnly(left)
    && !isRecordingOnly(right)
  ) return false

  const leftPhone = normalizedPhone(left)
  const rightPhone = normalizedPhone(right)
  if (leftPhone && rightPhone && leftPhone !== rightPhone) return false

  const leftSubject = callSubject(left)
  const rightSubject = callSubject(right)
  if (leftSubject && rightSubject && leftSubject !== rightSubject) return false

  const leftOutcome = callOutcome(left)
  const rightOutcome = callOutcome(right)
  if (
    leftOutcome
    && rightOutcome
    && leftOutcome !== rightOutcome
    && FAILURE_OUTCOMES.has(leftOutcome)
    && FAILURE_OUTCOMES.has(rightOutcome)
  ) return false

  return true
}

function recordingGroupScore(
  recording: LeadConversationActivity,
  group: LeadConversationActivity[],
): number | null {
  if (group.some((activity) => hasSharedCallId(recording, activity))) return -1

  const recordingPhone = normalizedPhone(recording)
  const groupPhones = group.map(normalizedPhone).filter((value): value is string => Boolean(value))
  if (recordingPhone && groupPhones.length > 0 && !groupPhones.includes(recordingPhone)) return null

  const distance = Math.min(...group.map((activity) => (
    Math.abs(timestamp(recording.created_at) - timestamp(activity.created_at))
  )))
  if (distance > DUPLICATE_CALL_WINDOW_MS) return null

  const recordingDirection = normalizedDirection(recording)
  const groupDirection = group.map(normalizedDirection).find(Boolean)
  const directionPenalty = recordingDirection && groupDirection && recordingDirection !== groupDirection
    ? 30_000
    : 0
  return distance + directionPenalty
}

function outcomePriority(outcome: CallOutcome | null): number {
  if (outcome === 'appointment_set') return 8
  if (outcome === 'connected') return 7
  if (outcome === 'left_voicemail') return 6
  if (outcome === 'no_answer' || outcome === 'busy' || outcome === 'disconnected') return 5
  if (outcome === 'failed') return 4
  if (outcome === 'attempted') return 1
  return 0
}

function callScore(activity: LeadConversationActivity): number {
  let score = outcomePriority(callOutcome(activity)) * 10
  if (activity.agent && !/^(?:system|ai)$/i.test(activity.agent.trim())) score += 8
  if (normalizedDirection(activity)) score += 4
  if (metadataText(activity, 'notes')) score += 3
  if (isRecordingOnly(activity)) score -= 10
  return score
}

function recordingDuration(activity: LeadConversationActivity): number | null {
  const specific = metadataNumber(activity, ['recordingDuration', 'RecordingDuration', 'duration_seconds'])
  if (specific != null) return specific
  return isRecordingOnly(activity) ? metadataNumber(activity, ['duration']) : null
}

function callDuration(activity: LeadConversationActivity): number | null {
  const metadataDuration = metadataNumber(activity, ['duration', 'dialCallDuration'])
  if (metadataDuration != null) return metadataDuration
  const descriptionDuration = activity.description?.match(/(?:—|\()\s*(\d+)s\)?\s*$/i)
  return descriptionDuration ? Number(descriptionDuration[1]) : null
}

function outcomeLabel(outcome: CallOutcome | null): string {
  if (outcome === 'appointment_set') return 'Appointment set'
  if (outcome === 'connected') return 'Connected'
  if (outcome === 'left_voicemail') return 'Left voicemail'
  if (outcome === 'no_answer') return 'No answer'
  if (outcome === 'busy') return 'Busy'
  if (outcome === 'disconnected') return 'Disconnected'
  if (outcome === 'failed') return 'Failed'
  return 'Attempted'
}

function callNarrative(group: LeadConversationActivity[], hasRecordingInGroup: boolean): string {
  const note = group
    .map((activity) => metadataText(activity, 'notes'))
    .find((value): value is string => Boolean(value))
  if (note) return note

  const mojo = group
    .map((activity) => activity.description?.match(/^Mojo call\s*[—-]\s*(.+)$/i)?.[1]?.trim())
    .find((value): value is string => Boolean(value))
  if (mojo) return mojo

  const rankedOutcomes = group
    .map(callOutcome)
    .sort((left, right) => outcomePriority(right) - outcomePriority(left))
  const outcome = rankedOutcomes[0] || null
  const label = outcomeLabel(outcome)
  if (hasRecordingInGroup || outcome !== 'connected') return label

  const duration = group.map(callDuration).find((value): value is number => value != null)
  return duration ? `${label} · ${formatCallDuration(duration)}` : label
}

function mergeCallGroup<T extends LeadConversationActivity>(group: T[]): NormalizedActivity<T> {
  const ranked = [...group].sort((left, right) => callScore(right) - callScore(left))
  const base = ranked[0]
  const recording = ranked.find(hasRecording)
  const directionSource = ranked.find((activity) => normalizedDirection(activity) && !isRecordingOnly(activity))
    || ranked.find((activity) => normalizedDirection(activity))
  const agent = ranked.find((activity) => activity.agent && !/^(?:system|ai)$/i.test(activity.agent.trim()))?.agent
    ?? base.agent
  const metadata = { ...(base.metadata || {}) }
  const direction = directionSource ? normalizedDirection(directionSource) : null
  if (direction) metadata.direction = direction

  if (recording?.metadata) {
    for (const key of RECORDING_FIELDS) {
      const value = recording.metadata[key]
      if (value != null && value !== '') metadata[key] = value
    }
    const duration = recordingDuration(recording)
    if (duration != null) metadata.recordingDuration = duration
  }

  return {
    ...base,
    agent,
    description: callNarrative(group, Boolean(recording)),
    metadata,
    recordingActivityId: recording?.id,
    collapsedActivityIds: group.map((activity) => activity.id),
  }
}

function callNoteKind(activity: LeadConversationActivity): 'summary' | 'transcript' | null {
  if (activity.activity_type !== 'note' && activity.activity_type !== 'agent_note') return null
  const description = activity.description?.trim() || ''
  if (/^(?:AI Call Analysis|AI Call Summary):/i.test(description)) return 'summary'
  if (/^(?:Call transcript|Mojo call transcript):/i.test(description)) return 'transcript'
  return null
}

function stripCallNotePrefix(description: string): string {
  return description.replace(/^(?:AI Call Analysis|AI Call Summary|Call transcript|Mojo call transcript):\s*/i, '').trim()
}

function closestCallForNote<T extends LeadConversationActivity>(note: T, calls: NormalizedActivity<T>[]): NormalizedActivity<T> | null {
  const noteTimestamp = timestamp(note.created_at)
  let closest: { activity: NormalizedActivity<T>; distance: number } | null = null

  for (const call of calls) {
    const distance = Math.abs(timestamp(call.created_at) - noteTimestamp)
    if (distance > CALL_NOTE_WINDOW_MS) continue
    if (!closest || distance < closest.distance) closest = { activity: call, distance }
  }
  return closest?.activity || null
}

function isConversationNoise(activity: LeadConversationActivity): boolean {
  const description = activity.description?.trim() || ''
  if (activity.activity_type === 'sms' && /^SMS\b.*\b(?:queued|delivered|sent)$/i.test(description)) return true
  if (
    (activity.activity_type === 'note' || activity.activity_type === 'agent_note')
    && (/^Call submitted to .+ for review\b/i.test(description) || /^AI-proposed CRM changes reviewed and applied$/i.test(description))
  ) return true
  return false
}

export function leadActivityText(activity: LeadConversationActivity): string {
  const raw = activity.description?.trim() || ''
  const notification = raw.match(/just texted:\s*["“]([\s\S]*?)["”]\s*(?:—|$)/i)
  if (notification?.[1]) return notification[1].trim()
  return raw || (activity.activity_type === 'call' ? 'Call activity' : 'No details recorded')
}

export function normalizeLeadConversation<T extends LeadConversationActivity>(activities: T[], limit = 50): NormalizedActivity<T>[] {
  const candidates = activities
    .filter((activity) => COMMUNICATION_TYPES.has(activity.activity_type) && !isConversationNoise(activity))
    .sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at))

  const rawCalls = candidates.filter((activity) => activity.activity_type === 'call')
  const callGroups: T[][] = []
  for (const call of rawCalls.filter((activity) => !isRecordingOnly(activity))) {
    const group = callGroups.find((current) => current.some((candidate) => callsBelongTogether(candidate, call)))
    if (group) group.push(call)
    else callGroups.push([call])
  }
  for (const recording of rawCalls.filter(isRecordingOnly)) {
    const rankedGroups = callGroups
      .map((group, index) => ({ index, score: recordingGroupScore(recording, group) }))
      .filter((candidate): candidate is { index: number; score: number } => candidate.score != null)
      .sort((left, right) => left.score - right.score)
    const closest = rankedGroups[0]
    if (closest) callGroups[closest.index].push(recording)
    else callGroups.push([recording])
  }
  const calls = callGroups.map(mergeCallGroup)

  const normalized: NormalizedActivity<T>[] = []
  for (const activity of candidates) {
    if (activity.activity_type === 'call') continue

    const noteKind = callNoteKind(activity)
    if (noteKind && activity.description) {
      const call = closestCallForNote(activity, calls)
      if (call) {
        const detail = stripCallNotePrefix(activity.description)
        if (noteKind === 'summary') call.callSummary = detail
        else call.callTranscript = detail
        continue
      }
    }

    const body = leadActivityText(activity).toLowerCase().replace(/\s+/g, ' ')
    const activityTimestamp = timestamp(activity.created_at)
    const duplicateIndex = normalized.findIndex((candidate) => (
      candidate.activity_type === activity.activity_type
      && leadActivityText(candidate).toLowerCase().replace(/\s+/g, ' ') === body
      && Math.abs(timestamp(candidate.created_at) - activityTimestamp) < 120_000
    ))

    if (duplicateIndex < 0) {
      normalized.push(activity)
      continue
    }

    const candidateHasDirection = Boolean(normalized[duplicateIndex].metadata?.direction)
    const activityHasDirection = Boolean(activity.metadata?.direction)
    if (activityHasDirection && !candidateHasDirection) normalized[duplicateIndex] = activity
  }

  return [...calls, ...normalized]
    .sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at))
    .slice(0, limit)
}

export function filterLeadConversation<T extends LeadConversationActivity>(
  activities: T[],
  filter: LeadCommunicationFilter,
): T[] {
  if (filter === 'all') return activities
  if (filter === 'note') return activities.filter((activity) => activity.activity_type === 'note' || activity.activity_type === 'agent_note')
  return activities.filter((activity) => activity.activity_type === filter)
}

export function leadConversationCounts(activities: LeadConversationActivity[]): Record<LeadCommunicationFilter, number> {
  return activities.reduce<Record<LeadCommunicationFilter, number>>((counts, activity) => {
    counts.all += 1
    if (activity.activity_type === 'note' || activity.activity_type === 'agent_note') counts.note += 1
    else if (activity.activity_type === 'call' || activity.activity_type === 'sms' || activity.activity_type === 'email' || activity.activity_type === 'voicemail') counts[activity.activity_type] += 1
    return counts
  }, { all: 0, call: 0, sms: 0, email: 0, note: 0, voicemail: 0 })
}
