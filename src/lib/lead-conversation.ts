export type LeadCommunicationFilter = 'all' | 'call' | 'sms' | 'email' | 'note' | 'voicemail'

export interface LeadConversationActivity {
  id: string
  activity_type: string
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

const COMMUNICATION_TYPES = new Set(['sms', 'call', 'voicemail', 'email', 'note', 'agent_note'])

function timestamp(value: string): number {
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

export function leadActivityText(activity: LeadConversationActivity): string {
  const raw = activity.description?.trim() || ''
  const notification = raw.match(/just texted:\s*["“]([\s\S]*?)["”]\s*(?:—|$)/i)
  if (notification?.[1]) return notification[1].trim()
  return raw || (activity.activity_type === 'call' ? 'Call activity' : 'No details recorded')
}

export function normalizeLeadConversation<T extends LeadConversationActivity>(activities: T[], limit = 50): T[] {
  const normalized: T[] = []
  const sorted = [...activities].sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at))

  for (const activity of sorted) {
    if (!COMMUNICATION_TYPES.has(activity.activity_type)) continue
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

  return normalized
    .sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at))
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
