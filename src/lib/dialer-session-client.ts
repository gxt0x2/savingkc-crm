import type { DialerPostCallReview } from '@/lib/dialer-post-call-review'
import { dialerControllerHeaders } from '@/lib/telephony/dialer-controller-client'

export interface DurableDialerQueueSubject {
  kind: 'lead' | 'prospect'
  id: string
  leadId: string | null
  prospectId: string | null
  campaignMemberId: string | null
}

export interface DurableDialerSession {
  id: string
  status: 'active' | 'paused' | 'completed' | 'stopped'
  actorEmail: string
  agentName: string
  queueKey: string
  savedQueueId: string | null
  leadIds: string[]
  queueItems: DurableDialerQueueSubject[]
  queueSize: number
  currentIndex: number
  currentLeadId: string | null
  currentProspectId: string | null
  currentSubjectKind: 'lead' | 'prospect'
  currentSubjectId: string
  currentCampaignMemberId: string | null
  callerId: string | null
  settingsSnapshot: Record<string, unknown>
  dialsCompleted: number
  contacts: number
  skips: number
  outcomes: Record<string, number>
  startedAt: string
  pausedAt: string | null
  stopRequestedAt: string | null
  endedAt: string | null
  lastInteractionAt: string
  idleExpiresAt: string
  idleTimedOutAt: string | null
  updatedAt: string
}

export interface DialerPauseRequest {
  session: DurableDialerSession
  requiresDisposition: boolean
}

export interface DialerSessionControlSummary {
  sessionId: string
  campaignId: string | null
  campaignName: string
  status: DurableDialerSession['status']
  currentIndex: number
  queueSize: number
  controllerLabel: string | null
  heartbeatAt: string | null
  leaseExpiresAt: string | null
  generation: number
  stale: boolean
  attemptStatus: DurableDialerAttempt['status'] | null
  operationActive: boolean
  operationLabel: string | null
  operationExpiresAt: string | null
  canTakeOver: boolean
}

export interface DialerSessionControlResult {
  session: DurableDialerSession
  control: Record<string, unknown>
  transferred?: boolean
}

export class DialerSessionClientError extends Error {
  constructor(message: string, public readonly code?: string, public readonly details?: DialerSessionControlSummary) {
    super(message)
    this.name = 'DialerSessionClientError'
  }
}

export function isDialerControlLossError(error: unknown): error is DialerSessionClientError {
  return error instanceof DialerSessionClientError && [
    'session_control_changed',
    'session_control_conflict',
    'session_control_lost',
  ].includes(error.code || '')
}

export interface DurableDialerAttempt {
  id: string
  client_attempt_id: string
  subject_kind: 'lead' | 'prospect'
  subject_id: string
  campaign_member_id: string | null
  lead_id: string | null
  prospect_id: string | null
  prospect_phone_id: string | null
  phone: string
  caller_id: string
  status: 'authorized' | 'dialing' | 'connected' | 'awaiting_disposition' | 'dispositioned' | 'failed' | 'cancelled'
  disposition: string | null
  duration_seconds: number | null
  reached: boolean | null
  started_at: string | null
  connected_at: string | null
  ended_at: string | null
  dispositioned_at: string | null
  advanced_at: string | null
  created_at: string
  updated_at: string
  leadName: string | null
  propertyAddress: string | null
  postCallReview: DialerPostCallReview
}

export interface DialerHistoryPage<T> {
  items: T[]
  pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null }
}

export interface DialerTodayMetrics {
  metric_date: string
  dialing_seconds: number
  calls: number
  contacts: number
  leads: number
  generatedAt: string
}

async function payload(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as (Record<string, unknown> & {
    error?: string
    code?: string
    details?: DialerSessionControlSummary
  }) | null
  if (!response.ok || !body) throw new DialerSessionClientError(body?.error || fallback, body?.code, body?.details)
  return body
}

export async function loadDurableDialerSession(sessionId: string): Promise<DurableDialerSession> {
  const response = await fetch(`/api/dialer/sessions/${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
  const body = await payload(response, 'Could not load the dialer session.')
  if (!body.session) throw new Error('Could not load the dialer session.')
  return body.session as DurableDialerSession
}

export async function loadDialerTodayMetrics(): Promise<DialerTodayMetrics> {
  const response = await fetch('/api/dialer/metrics/today', { cache: 'no-store' })
  const body = await payload(response, 'Today’s dialer metrics are unavailable.')
  if (!body.metrics || typeof body.generatedAt !== 'string') throw new Error('Today’s dialer metrics are unavailable.')
  return { ...(body.metrics as Record<string, unknown>), generatedAt: body.generatedAt } as unknown as DialerTodayMetrics
}

export async function loadDialerSessionHistory(cursor?: string | null): Promise<DialerHistoryPage<DurableDialerSession>> {
  const params = new URLSearchParams({ scope: 'history', limit: '20' })
  if (cursor) params.set('cursor', cursor)
  const response = await fetch(`/api/dialer/sessions?${params.toString()}`, { cache: 'no-store' })
  return payload(response, 'Could not load dialer session history.') as unknown as Promise<DialerHistoryPage<DurableDialerSession>>
}

export async function loadDialerAttemptHistory(
  sessionId: string,
  cursor?: string | null,
): Promise<{ session: DurableDialerSession; attempts: DialerHistoryPage<DurableDialerAttempt> }> {
  const params = new URLSearchParams({ include: 'attempts', limit: '50' })
  if (cursor) params.set('cursor', cursor)
  const response = await fetch(`/api/dialer/sessions/${encodeURIComponent(sessionId)}?${params.toString()}`, { cache: 'no-store' })
  return payload(response, 'Could not load dialer session attempts.') as Promise<{ session: DurableDialerSession; attempts: DialerHistoryPage<DurableDialerAttempt> }>
}

export async function loadDialerPostCallReview(
  sessionId: string,
  clientAttemptId: string,
): Promise<DialerPostCallReview> {
  const response = await fetch(`/api/dialer/sessions/${encodeURIComponent(sessionId)}/attempts/${encodeURIComponent(clientAttemptId)}`, { cache: 'no-store' })
  const body = await payload(response, 'Could not load the post-call review.')
  if (!body.review) throw new Error('Could not load the post-call review.')
  return body.review as DialerPostCallReview
}

export async function decideDialerAiChanges(input: {
  sessionId: string
  clientAttemptId: string
  decision: 'approved' | 'rejected'
  decisionKey: string
  note?: string
}) {
  const response = await fetch(`/api/dialer/sessions/${encodeURIComponent(input.sessionId)}/attempts/${encodeURIComponent(input.clientAttemptId)}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...await dialerControllerHeaders() },
    body: JSON.stringify({ decision: input.decision, decisionKey: input.decisionKey, note: input.note }),
  })
  const body = await payload(response, 'Could not save the AI change decision.')
  if (!body.proposal) throw new Error('Could not save the AI change decision.')
  return body.proposal as DialerPostCallReview['changeProposal']
}

export async function loadDialerSavedQueuesWithOpenSession(): Promise<Record<string, unknown>[]> {
  const [savedResponse, sessionResponse] = await Promise.all([
    fetch('/api/dialer/saved-lists', { cache: 'no-store' }),
    fetch('/api/dialer/sessions', { cache: 'no-store' }),
  ])
  const savedBody = await savedResponse.json().catch(() => null)
  if (!savedResponse.ok) throw new Error(savedBody?.error || 'Could not load saved lists.')
  const queues = Array.isArray(savedBody?.savedLists) ? savedBody.savedLists as Record<string, unknown>[] : []
  if (!sessionResponse.ok) return queues
  const sessionBody = await sessionResponse.json().catch(() => null)
  const session = sessionBody?.session as DurableDialerSession | null
  if (!session) return queues

  const matchIndex = session.savedQueueId
    ? queues.findIndex((queue) => queue.id === session.savedQueueId)
    : -1
  const base = matchIndex >= 0 ? queues[matchIndex] : {}
  const resumeQueue: Record<string, unknown> = {
    ...base,
    durableSessionId: session.id,
    id: session.savedQueueId || session.id,
    name: typeof base.name === 'string' ? base.name : session.queueKey.replace(/_/g, ' '),
    agent: session.agentName,
    preset: typeof base.preset === 'string' ? base.preset : 'custom',
    callerId: session.callerId || '',
    campaign: typeof base.campaign === 'string' ? base.campaign : 'all',
    statusFilter: typeof base.statusFilter === 'string' ? base.statusFilter : 'all',
    priorityFilter: typeof base.priorityFilter === 'string' ? base.priorityFilter : 'all',
    minMotivation: Number(base.minMotivation) || 0,
    search: typeof base.search === 'string' ? base.search : '',
    sortBy: typeof base.sortBy === 'string' ? base.sortBy : 'recommended',
    visibleLimit: Number(base.visibleLimit) || 25,
    sessionLeadIds: session.leadIds,
    resumeIndex: session.currentIndex,
    resumeLeadId: session.currentLeadId,
    resumeUpdatedAt: session.updatedAt,
    sessionCompleted: false,
    createdAt: typeof base.createdAt === 'string' ? base.createdAt : session.updatedAt,
    updatedAt: session.updatedAt,
  }
  if (matchIndex >= 0) return queues.map((queue, index) => index === matchIndex ? resumeQueue : queue)
  return [resumeQueue, ...queues]
}

export async function createDurableDialerSession(input: {
  leadIds: string[]
  queueKey: string
  callerId: string
  savedQueueId?: string
  settings: Record<string, unknown>
}): Promise<{ created: boolean; session: DurableDialerSession }> {
  const response = await fetch('/api/dialer/sessions', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...await dialerControllerHeaders() },
    body: JSON.stringify(input),
  })
  const body = await response.json().catch(() => null)
  if ((!response.ok && response.status !== 409) || !body?.session) {
    throw new Error(body?.error || 'Could not create a durable dialer session.')
  }
  return { created: body.created === true, session: body.session as DurableDialerSession }
}

export async function transitionDurableDialerSession(
  sessionId: string,
  action: 'pause' | 'resume' | 'request_stop' | 'stop' | 'skip',
  reason?: string,
): Promise<DurableDialerSession> {
  const response = await fetch(`/api/dialer/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...await dialerControllerHeaders() },
    body: JSON.stringify({ action, reason }),
  })
  const body = await payload(response, 'Could not update the dialer session.')
  if (!body.session) throw new Error('Could not update the dialer session.')
  return body.session as DurableDialerSession
}

export async function requestPauseDurableDialerSession(
  sessionId: string,
  reason?: string,
): Promise<DialerPauseRequest> {
  const response = await fetch(`/api/dialer/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...await dialerControllerHeaders() },
    body: JSON.stringify({ action: 'request_pause', reason }),
  })
  const body = await payload(response, 'Could not pause the dialer session.')
  if (!body.session) throw new Error('Could not pause the dialer session.')
  return {
    session: body.session as DurableDialerSession,
    requiresDisposition: body.requiresDisposition === true,
  }
}

export async function transitionDurableDialerAttempt(input: {
  sessionId: string
  clientAttemptId: string
  action: 'started' | 'connected' | 'ended' | 'failed' | 'cancelled' | 'disposition' | 'advance'
  disposition?: string
  durationSeconds?: number
}) {
  const response = await fetch(`/api/dialer/sessions/${encodeURIComponent(input.sessionId)}/attempts/${encodeURIComponent(input.clientAttemptId)}`, {
    method: 'PATCH',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...await dialerControllerHeaders() },
    body: JSON.stringify(input),
  })
  return payload(response, 'Call session state could not be saved') as Promise<{ attempt?: unknown; session?: DurableDialerSession }>
}

export async function heartbeatDurableDialerSessionControl(
  sessionId: string,
  userActive = false,
): Promise<DialerSessionControlResult> {
  const response = await fetch(`/api/dialer/sessions/${encodeURIComponent(sessionId)}/control`, {
    method: 'PATCH',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...await dialerControllerHeaders() },
    body: JSON.stringify({ userActive }),
  })
  return payload(response, 'Dialing control could not be verified.') as unknown as Promise<DialerSessionControlResult>
}

export async function takeOverDurableDialerSession(input: {
  sessionId: string
  expectedGeneration: number
  requestId: string
}): Promise<DialerSessionControlResult> {
  const response = await fetch(`/api/dialer/sessions/${encodeURIComponent(input.sessionId)}/control`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...await dialerControllerHeaders() },
    body: JSON.stringify({
      action: 'takeover',
      expectedGeneration: input.expectedGeneration,
      requestId: input.requestId,
    }),
  })
  return payload(response, 'Dialing control could not be transferred.') as unknown as Promise<DialerSessionControlResult>
}
