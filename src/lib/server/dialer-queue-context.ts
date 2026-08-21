import type { DialerQueueContextRow, DialerQueueMetrics } from '@/lib/dialer-queue-contract'

const CALL_ACTIVITY_TYPES = new Set(['call', 'voicemail'])
const CENTRAL_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export interface DialerQueueFollowupRow {
  lead_id: string | null
  metadata: { due_date?: string; status?: string } | null
}

export interface DialerQueueContactRow {
  lead_id: string | null
  activity_type: string
  created_at: string
}

function centralDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = CENTRAL_DATE_FORMATTER.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  const year = part('year')
  const month = part('month')
  const day = part('day')
  return year && month && day ? `${year}-${month}-${day}` : ''
}

function laterTimestamp(current: string | null, candidate: string): string {
  if (!current) return candidate
  return new Date(candidate).getTime() > new Date(current).getTime() ? candidate : current
}

export function buildDialerQueueContext(
  leadIds: string[],
  followups: DialerQueueFollowupRow[],
  contactActivities: DialerQueueContactRow[],
  now = new Date(),
): { context: DialerQueueContextRow[]; metrics: DialerQueueMetrics } {
  const today = centralDateKey(now)
  const contextByLeadId = new Map<string, DialerQueueContextRow>()
  for (const leadId of leadIds) {
    if (!leadId || contextByLeadId.has(leadId)) continue
    contextByLeadId.set(leadId, {
      leadId,
      lastContactAt: null,
      lastDialedAt: null,
      callAttemptCount: 0,
      hasDueFollowup: false,
      scheduledToday: false,
    })
  }

  for (const followup of followups) {
    if (!followup.lead_id) continue
    const context = contextByLeadId.get(followup.lead_id)
    if (!context) continue
    const status = followup.metadata?.status?.toLowerCase() ?? 'pending'
    if (status === 'completed' || status === 'cancelled' || status === 'canceled') continue
    const dueDate = followup.metadata?.due_date ? centralDateKey(followup.metadata.due_date) : ''
    if (!dueDate) continue
    if (dueDate <= today) context.hasDueFollowup = true
    if (dueDate === today) context.scheduledToday = true
  }

  let callsToday = 0
  const leadsCalledToday = new Set<string>()
  for (const activity of contactActivities) {
    if (!activity.lead_id) continue
    const context = contextByLeadId.get(activity.lead_id)
    if (!context || !centralDateKey(activity.created_at)) continue
    context.lastContactAt = laterTimestamp(context.lastContactAt, activity.created_at)
    if (!CALL_ACTIVITY_TYPES.has(activity.activity_type)) continue
    context.callAttemptCount += 1
    context.lastDialedAt = laterTimestamp(context.lastDialedAt, activity.created_at)
    if (centralDateKey(activity.created_at) === today) {
      callsToday += 1
      leadsCalledToday.add(activity.lead_id)
    }
  }

  return {
    context: [...contextByLeadId.values()],
    metrics: {
      callsToday,
      uniqueLeadsToday: leadsCalledToday.size,
    },
  }
}
