export interface DialerQueueContextRow {
  leadId: string
  lastContactAt: string | null
  lastDialedAt: string | null
  callAttemptCount: number
  hasDueFollowup: boolean
  scheduledToday: boolean
}

export interface DialerQueueMetrics {
  callsToday: number
  uniqueLeadsToday: number
}
