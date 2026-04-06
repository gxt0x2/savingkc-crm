'use client'

import { useState, useEffect, useCallback } from 'react'

// Types
export interface CallQueueLead {
  id: string
  full_name: string
  phone: string
  property_address: string | null
  city: string | null
  station: string | null
  priority: string | null
  score: number
  reason: string
  last_contact: string | null
  inbound_activity: { created_at: string; description: string; type: string } | null
}

export interface FollowUp {
  id: string
  title: string
  description: string | null
  due_date: string
  priority: string
  status: string
  is_overdue: boolean
  lead_id: string | null
  lead_name: string | null
  lead_phone: string | null
  lead_address: string | null
  lead_station: string | null
}

export interface InboxItem {
  id: string
  type: 'sms' | 'missed_call'
  lead_id: string
  lead_name: string
  phone: string | null
  station: string | null
  message: string | null
  created_at: string
}

export interface PipelineAction {
  id: string
  full_name: string
  phone: string
  property_address: string | null
  city: string | null
  station: string | null
  priority: string | null
  motivation_score: number | null
  offer_amount: number | null
  action_type: string
  action_label: string
  action_detail: string
}

export interface CoachingData {
  greeting: string
  nudges: string[]
  momentum: string | null
  mode: string
}

export interface EodData {
  mode: 'eod'
  stats: { calls: number; smsSent: number; smsReceived: number; tasksCompleted: number; totalTasks: number }
  wrapUp: string
}

export interface AriPageData {
  // Call Queue
  callQueue: CallQueueLead[]
  callTargets: { dials: number; contacts: number; appointments: number }
  callCounts: { dials: number; contacts: number; appointments: number }

  // Follow-ups
  followUps: FollowUp[]
  followUpCompleted: number
  followUpTotal: number

  // Inbox
  inboxItems: InboxItem[]
  inboxCount: number

  // Pipeline
  pipelineActions: PipelineAction[]
  pipelineHandled: number
  pipelineTotal: number

  // Coaching
  coaching: CoachingData | null

  // EOD
  eod: EodData | null

  // Activity counts
  activityCounts: { calls: number; sms_sent: number; sms_received: number; voicemails: number }

  // Loading state
  loading: boolean

  // Refresh functions
  refreshCallQueue: () => void
  refreshFollowUps: () => void
  refreshInbox: () => void
  refreshPipeline: () => void
  refreshAll: () => void
}

function useFetch<T>(url: string, defaultVal: T, extract?: (data: any) => T) {
  const [data, setData] = useState<T>(defaultVal)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    fetch(url)
      .then(r => r.json())
      .then(d => setData(extract ? extract(d) : d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [url])

  useEffect(() => { refresh() }, [refresh])

  return { data, loading, refresh }
}

export function useAriPage(): AriPageData {
  // Call Queue
  const callQueueFetch = useFetch('/api/ari/call-queue', { queue: [], targets: { dials: 50, contacts: 10, appointments: 2 }, counts: { dials: 0, contacts: 0, appointments: 0 } })

  // Follow-ups
  const followUpsFetch = useFetch('/api/ari/follow-ups', { followUps: [], completed: 0, total: 0 })

  // Inbox
  const inboxFetch = useFetch('/api/ari/inbox', { items: [], count: 0 })

  // Pipeline Actions
  const pipelineFetch = useFetch('/api/ari/pipeline-actions', { actions: [], handled: 0, total: 0 })

  // Coaching
  const coachingFetch = useFetch<CoachingData | null>('/api/ari/coaching?mode=morning', null)

  // EOD
  const eodFetch = useFetch<EodData | null>('/api/ari/coaching?mode=eod', null)

  // Activity counts
  const activityFetch = useFetch('/api/dashboard/activity', { calls: 0, sms_sent: 0, sms_received: 0, voicemails: 0 })

  const loading = callQueueFetch.loading || followUpsFetch.loading || inboxFetch.loading

  const refreshAll = useCallback(() => {
    callQueueFetch.refresh()
    followUpsFetch.refresh()
    inboxFetch.refresh()
    pipelineFetch.refresh()
    coachingFetch.refresh()
    activityFetch.refresh()
    eodFetch.refresh()
  }, [])

  return {
    callQueue: callQueueFetch.data.queue,
    callTargets: callQueueFetch.data.targets,
    callCounts: callQueueFetch.data.counts,

    followUps: followUpsFetch.data.followUps,
    followUpCompleted: followUpsFetch.data.completed,
    followUpTotal: followUpsFetch.data.total,

    inboxItems: inboxFetch.data.items,
    inboxCount: inboxFetch.data.count,

    pipelineActions: pipelineFetch.data.actions,
    pipelineHandled: pipelineFetch.data.handled,
    pipelineTotal: pipelineFetch.data.total,

    coaching: coachingFetch.data,
    eod: eodFetch.data,

    activityCounts: activityFetch.data,

    loading,

    refreshCallQueue: callQueueFetch.refresh,
    refreshFollowUps: followUpsFetch.refresh,
    refreshInbox: inboxFetch.refresh,
    refreshPipeline: pipelineFetch.refresh,
    refreshAll,
  }
}
