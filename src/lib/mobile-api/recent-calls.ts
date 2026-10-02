import { twilioRecordingSid } from '@/lib/mobile-api/twilio-recording'
import { mobileRecordingUrl } from '@/lib/mobile-api/mojo-recording'
import { mobileInboundRoute, type MobileInboundRoute } from '@/lib/mobile-api/inbound-route'

export type RecentCallActivityRow = {
  id: string
  lead_id?: string | null
  agent?: string | null
  activity_type: string
  description?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
}

export type MobileRecentCallItem = {
  id: string
  leadId: string | null
  phone: string
  direction: 'outbound' | 'inbound'
  startedAt: string
  durationSeconds: number
  outcome: 'answered' | 'no_answer' | 'voicemail' | 'bad_number' | 'dnc' | 'failed'
  note: string | null
  source: string | null
  inboundRoute: MobileInboundRoute | null
  providerStatus: string | null
  recordingUrl: string | null
  agent: string | null
  metadata: Record<string, string>
}

const IDENTITY_KEYS = [
  'from', 'from_number', 'fromNumber', 'callerId', 'caller_id',
  'to', 'to_number', 'toNumber', 'agent_identity', 'identity',
  'assigned_to', 'assignedTo', 'user_name', 'userName',
] as const

function text(metadata: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function number(metadata: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Math.max(0, Math.round(Number(value)))
    }
  }
  return 0
}

function outcomeFor(row: RecentCallActivityRow, metadata: Record<string, unknown>): MobileRecentCallItem['outcome'] {
  const values = ['outcome', 'disposition', 'status', 'reason_code']
    .flatMap((key) => {
      const value = text(metadata, key)
      return value ? [value.toLowerCase()] : []
    })
  if (values.some((value) => ['blocked', 'failed', 'canceled', 'cancelled', 'not_placed', 'policy_unavailable'].includes(value))) return 'failed'
  const value = values[0] || row.activity_type.toLowerCase()
  if (['answered', 'connected', 'completed'].includes(value)) return 'answered'
  if (value === 'voicemail') return 'voicemail'
  if (['bad_number', 'disconnected'].includes(value)) return 'bad_number'
  if (['dnc', 'do_not_call'].includes(value)) return 'dnc'
  return 'no_answer'
}

function attemptKey(row: RecentCallActivityRow, metadata: Record<string, unknown>): string {
  return text(metadata, 'clientCallId', 'clientAttemptId', 'client_attempt_id', 'callSid', 'call_sid', 'parentCallSid')
    || `activity:${row.id}`
}

function evidenceRank(metadata: Record<string, unknown>): number {
  const source = text(metadata, 'source')
  if (source === 'savingkc_mobile') return 3
  if (source === 'outbound_call_policy') return 2
  if (source === 'twilio_status_callback') return 1
  return 0
}

function identityMetadata(metadata: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of IDENTITY_KEYS) {
    const value = text(metadata, key)
    if (value) result[key] = value
  }
  return result
}

function mapRecentCall(row: RecentCallActivityRow, groupedRows: RecentCallActivityRow[]): MobileRecentCallItem {
  const metadata = row.metadata ?? {}
  const directionValue = (text(metadata, 'direction')
    || groupedRows.map((candidate) => text(candidate.metadata ?? {}, 'direction')).find(Boolean))?.toLowerCase()
  const direction = ['inbound', 'incoming', 'in', 'received', 'inbound-api'].includes(directionValue || '')
    || row.activity_type === 'missed_call' ? 'inbound' : 'outbound'
  const combined = Object.assign({}, ...groupedRows.slice().reverse().map((candidate) => identityMetadata(candidate.metadata ?? {}))) as Record<string, string>
  const inboundRoute = direction === 'inbound'
    ? groupedRows.map((candidate) => mobileInboundRoute(candidate.metadata ?? {}, candidate.description)).find(Boolean) ?? null
    : null
  const actualAgent = row.agent?.trim() || groupedRows.map((candidate) => candidate.agent?.trim()).find(Boolean)
    || text(metadata, 'agent', 'userEmail') || null
  if (actualAgent && !combined.agent_identity) combined.agent_identity = actualAgent
  const phone = direction === 'inbound'
    ? text(metadata, 'from', 'phone', 'to') || text(combined, 'from', 'from_number', 'fromNumber') || ''
    : text(metadata, 'to', 'phone', 'from') || text(combined, 'to', 'to_number', 'toNumber') || ''
  return {
    id: row.id,
    leadId: row.lead_id ?? null,
    phone,
    direction,
    startedAt: text(metadata, 'startedAt', 'started_at') || row.created_at,
    durationSeconds: number(metadata, 'duration', 'durationSeconds', 'duration_seconds'),
    outcome: outcomeFor(row, metadata),
    note: text(metadata, 'notes') || row.description?.trim() || null,
    source: text(metadata, 'source'),
    inboundRoute,
    providerStatus: text(metadata, 'status'),
    recordingUrl: (() => {
      const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim()
      const recording = groupedRows.find((candidate) => candidate.lead_id
        && mobileRecordingUrl(candidate.id, candidate.metadata ?? {}, accountSid, twilioRecordingSid))
      return recording ? mobileRecordingUrl(recording.id, recording.metadata ?? {}, accountSid, twilioRecordingSid) : null
    })(),
    agent: actualAgent,
    metadata: combined,
  }
}

/** Collapse provider callbacks and operator dispositions by the durable call attempt. */
export function buildMobileRecentCalls(rows: RecentCallActivityRow[], limit = 100): MobileRecentCallItem[] {
  const selected = new Map<string, { row: RecentCallActivityRow; rank: number; rows: RecentCallActivityRow[] }>()
  const sorted = [...rows].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
  for (const row of sorted) {
    const metadata = row.metadata ?? {}
    const key = attemptKey(row, metadata)
    const rank = evidenceRank(metadata)
    const current = selected.get(key)
    if (!current) selected.set(key, { row, rank, rows: [row] })
    else {
      current.rows.push(row)
      if (rank > current.rank) selected.set(key, { ...current, row, rank })
    }
  }
  return [...selected.values()]
    .map(({ row, rows }) => mapRecentCall(row, rows))
    .sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt))
    .slice(0, Math.max(1, Math.min(100, limit)))
}
