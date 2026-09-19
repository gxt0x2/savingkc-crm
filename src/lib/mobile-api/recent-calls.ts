export type RecentCallOutcome = 'answered' | 'no_answer' | 'voicemail' | 'bad_number' | 'dnc' | 'failed'

export type RecentCallActivityRow = {
  id: string
  lead_id?: string | null
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
  outcome: RecentCallOutcome
  note: string | null
  source: string | null
  providerStatus: string | null
}

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

function outcomeFor(row: RecentCallActivityRow, metadata: Record<string, unknown>): RecentCallOutcome {
  const values = ['outcome', 'disposition', 'status', 'reason_code']
    .flatMap((key) => {
      const value = text(metadata, key)
      return value ? [value.toLowerCase()] : []
    })
  if (values.some((value) => ['blocked', 'failed', 'canceled', 'cancelled', 'not_placed', 'policy_unavailable'].includes(value))) {
    return 'failed'
  }
  const value = values[0] || row.activity_type.toLowerCase()
  if (value === 'answered' || value === 'connected' || value === 'completed') return 'answered'
  if (value === 'voicemail') return 'voicemail'
  if (value === 'bad_number' || value === 'disconnected') return 'bad_number'
  if (value === 'dnc' || value === 'do_not_call') return 'dnc'
  return 'no_answer'
}

function attemptKey(row: RecentCallActivityRow, metadata: Record<string, unknown>): string {
  return text(
    metadata,
    'clientCallId',
    'clientAttemptId',
    'client_attempt_id',
    'callSid',
    'call_sid',
    'parentCallSid',
  ) || `activity:${row.id}`
}

function evidenceRank(metadata: Record<string, unknown>): number {
  const source = text(metadata, 'source')
  if (source === 'savingkc_mobile') return 3
  if (source === 'outbound_call_policy') return 2
  if (source === 'twilio_status_callback') return 1
  return 0
}

function mapRecentCall(row: RecentCallActivityRow): MobileRecentCallItem {
  const metadata = row.metadata ?? {}
  const direction = text(metadata, 'direction') === 'inbound'
    || row.activity_type === 'missed_call'
    ? 'inbound'
    : 'outbound'
  const phone = direction === 'inbound'
    ? text(metadata, 'from', 'phone', 'to') || ''
    : text(metadata, 'to', 'phone', 'from') || ''
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
    providerStatus: text(metadata, 'status'),
  }
}

/**
 * Provider callbacks and the operator's later disposition describe the same
 * call. Collapse them by their durable attempt identity and prefer the richer
 * operator outcome without hiding provider-only or blocked attempts.
 */
export function buildMobileRecentCalls(
  rows: RecentCallActivityRow[],
  limit = 100,
): MobileRecentCallItem[] {
  const selected = new Map<string, { row: RecentCallActivityRow; rank: number }>()
  const sorted = [...rows].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
  for (const row of sorted) {
    const metadata = row.metadata ?? {}
    const key = attemptKey(row, metadata)
    const rank = evidenceRank(metadata)
    const current = selected.get(key)
    if (!current || rank > current.rank) selected.set(key, { row, rank })
  }
  return [...selected.values()]
    .map(({ row }) => mapRecentCall(row))
    .sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt))
    .slice(0, Math.max(1, Math.min(100, limit)))
}
