import { supabase } from '@/lib/supabase-lazy'
import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  parseDialerPostCallReview,
  type DialerPostCallReview,
  type DialerPostCallRow,
} from '@/lib/dialer-post-call-review'
import { parseAiChangeProposal, type AiChangeProposal } from '@/lib/ai-change-proposal'

export type DialerSessionStatus = 'active' | 'paused' | 'completed' | 'stopped'

export type DialerQueueSubjectKind = 'lead' | 'prospect'

export interface DialerQueueSubject {
  kind: DialerQueueSubjectKind
  id: string
  leadId: string | null
  prospectId: string | null
  campaignMemberId: string | null
}

export interface DialerSessionState {
  id: string
  status: DialerSessionStatus
  actorEmail: string
  agentName: string
  queueKey: string
  savedQueueId: string | null
  leadIds: string[]
  queueItems: DialerQueueSubject[]
  queueSize: number
  currentIndex: number
  currentLeadId: string | null
  currentProspectId: string | null
  currentSubjectKind: DialerQueueSubjectKind
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
  updatedAt: string
  stateVersion: number
}

export interface DialerAttemptState {
  id: string
  session_id: string
  client_attempt_id: string
  subject_kind: DialerQueueSubjectKind
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
}

export interface DialerAttemptHistoryItem extends DialerAttemptState {
  leadName: string | null
  propertyAddress: string | null
  postCallReview: DialerPostCallReview
}

export interface DialerHistoryPage<T> {
  items: T[]
  pageInfo: {
    limit: number
    hasMore: boolean
    nextCursor: string | null
  }
}

export class DialerSessionError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'DialerSessionError'
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim())
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeLeadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(isUuid).map((item) => item.trim())
}

function normalizeQueueItems(value: unknown, legacyLeadIds: string[]): DialerQueueSubject[] {
  const source = Array.isArray(value) ? value : legacyLeadIds
  const items = source.flatMap((raw): DialerQueueSubject[] => {
    if (isUuid(raw)) {
      const id = raw.trim()
      return [{ kind: 'lead', id, leadId: id, prospectId: null, campaignMemberId: null }]
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const row = raw as Record<string, unknown>
    const kind = textValue(row.kind)
    const id = textValue(row.id)
    const leadId = textValue(row.leadId)
    const prospectId = textValue(row.prospectId)
    const campaignMemberId = textValue(row.campaignMemberId)
    if (!id || !isUuid(id) || !kind || !['lead', 'prospect'].includes(kind)) return []
    if (campaignMemberId && !isUuid(campaignMemberId)) return []
    if (kind === 'lead' && (leadId !== id || prospectId)) return []
    if (kind === 'prospect' && (prospectId !== id || leadId)) return []
    return [{
      kind: kind as DialerQueueSubjectKind,
      id,
      leadId: kind === 'lead' ? id : null,
      prospectId: kind === 'prospect' ? id : null,
      campaignMemberId,
    }]
  })
  return items
}

function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([key, count]) => {
    const parsed = Number(count)
    return Number.isFinite(parsed) && parsed >= 0 ? [[key, parsed]] : []
  }))
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function parseDialerSession(value: unknown): DialerSessionState {
  if (!value || typeof value !== 'object') throw new DialerSessionError('invalid_session_payload', 503, 'Dialer session data is unavailable')
  const row = value as Record<string, unknown>
  const id = textValue(row.id)
  const status = textValue(row.status)
  const actorEmail = textValue(row.actorEmail)
  const agentName = textValue(row.agentName)
  const queueKey = textValue(row.queueKey)
  const startedAt = textValue(row.startedAt)
  const updatedAt = textValue(row.updatedAt)
  if (!id || !isUuid(id) || !actorEmail || !agentName || !queueKey || !startedAt || !updatedAt || !status || !['active', 'paused', 'completed', 'stopped'].includes(status)) {
    throw new DialerSessionError('invalid_session_payload', 503, 'Dialer session data is unavailable')
  }
  const legacyLeadIds = normalizeLeadIds(row.leadIds)
  const queueItems = normalizeQueueItems(row.queueItems, legacyLeadIds)
  const queueSize = numberValue(row.queueSize)
  const currentIndex = numberValue(row.currentIndex)
  if (queueSize < 1 || queueItems.length !== queueSize || currentIndex < 0 || currentIndex >= queueSize) {
    throw new DialerSessionError('invalid_session_payload', 503, 'Dialer session data is unavailable')
  }
  const currentItem = queueItems[currentIndex]
  const currentSubjectKind = textValue(row.currentSubjectKind) || currentItem.kind
  const currentSubjectId = textValue(row.currentSubjectId) || currentItem.id
  const currentLeadId = textValue(row.currentLeadId) || currentItem.leadId
  const currentProspectId = textValue(row.currentProspectId) || currentItem.prospectId
  const currentCampaignMemberId = textValue(row.currentCampaignMemberId) || currentItem.campaignMemberId
  if (currentSubjectKind !== currentItem.kind || currentSubjectId !== currentItem.id
    || currentLeadId !== currentItem.leadId || currentProspectId !== currentItem.prospectId
    || currentCampaignMemberId !== currentItem.campaignMemberId) {
    throw new DialerSessionError('invalid_session_payload', 503, 'Dialer session data is unavailable')
  }
  return {
    id,
    status: status as DialerSessionStatus,
    actorEmail,
    agentName,
    queueKey,
    savedQueueId: textValue(row.savedQueueId),
    leadIds: queueItems.flatMap((item) => item.leadId ? [item.leadId] : []),
    queueItems,
    queueSize,
    currentIndex,
    currentLeadId,
    currentProspectId,
    currentSubjectKind: currentItem.kind,
    currentSubjectId: currentItem.id,
    currentCampaignMemberId,
    callerId: textValue(row.callerId),
    settingsSnapshot: objectRecord(row.settingsSnapshot),
    dialsCompleted: numberValue(row.dialsCompleted),
    contacts: numberValue(row.contacts),
    skips: numberValue(row.skips),
    outcomes: numberRecord(row.outcomes),
    startedAt,
    pausedAt: textValue(row.pausedAt),
    stopRequestedAt: textValue(row.stopRequestedAt),
    endedAt: textValue(row.endedAt),
    updatedAt,
    stateVersion: numberValue(row.stateVersion, 1),
  }
}

function mapDatabaseError(error: { message?: string; code?: string } | null | undefined): DialerSessionError {
  const raw = `${error?.message || ''} ${error?.code || ''}`.toLowerCase()
  if (raw.includes('session_not_found')) return new DialerSessionError('session_not_found', 404, 'Dialer session not found')
  if (raw.includes('call_in_progress') || raw.includes('attempt_in_progress')) return new DialerSessionError('call_in_progress', 409, 'Finish or disposition the current call first')
  if (raw.includes('session_stop_requested')) return new DialerSessionError('session_stop_requested', 409, 'This calling session is ending; finish the current call outcome')
  if (raw.includes('dialer_recently_contacted')) return new DialerSessionError('dialer_recently_contacted', 409, 'This number was contacted inside the session hold period')
  if (raw.includes('dialer_recently_dialed')) return new DialerSessionError('dialer_recently_dialed', 409, 'This number was dialed inside the session hold period')
  if (raw.includes('session_not_active')) return new DialerSessionError('session_not_active', 409, 'Resume the dialer session before calling')
  if (raw.includes('session_lead_mismatch') || raw.includes('session_subject_mismatch') || raw.includes('attempt_context_mismatch')) return new DialerSessionError('session_context_mismatch', 409, 'The selected contact no longer matches the active dialer session')
  if (raw.includes('disposition_required')) return new DialerSessionError('disposition_required', 409, 'Save a call outcome before advancing')
  if (raw.includes('disposition_conflict')) return new DialerSessionError('disposition_conflict', 409, 'This attempt already has a different saved outcome')
  if (raw.includes('skip_reason_required')) return new DialerSessionError('skip_reason_required', 400, 'A skip reason is required')
  if (raw.includes('invalid_') || raw.includes('23514') || raw.includes('22p02')) return new DialerSessionError('invalid_session_request', 400, 'The dialer session request is invalid')
  if (raw.includes('does not exist') || raw.includes('pgrst202') || raw.includes('42p01') || raw.includes('42883')) {
    return new DialerSessionError('session_engine_unavailable', 503, 'Durable dialer sessions are not available in this environment')
  }
  return new DialerSessionError('session_engine_unavailable', 503, 'Dialer session state could not be saved')
}

export async function startDialerSession(input: {
  actor: AuthenticatedActor
  leadIds: string[]
  queueKey: string
  callerId: string
  savedQueueId?: string | null
  settings?: Record<string, unknown>
}): Promise<{ created: boolean; session: DialerSessionState }> {
  const leadIds = Array.from(new Set(input.leadIds.filter(isUuid).map((id) => id.trim())))
  if (leadIds.length < 1 || leadIds.length > 100 || leadIds.length !== input.leadIds.length) {
    throw new DialerSessionError('invalid_queue', 400, 'Select between 1 and 100 valid contacts')
  }
  if (input.savedQueueId && !isUuid(input.savedQueueId)) throw new DialerSessionError('invalid_saved_queue', 400, 'Saved queue is invalid')

  const queueItems: DialerQueueSubject[] = leadIds.map((id) => ({
    kind: 'lead', id, leadId: id, prospectId: null, campaignMemberId: null,
  }))
  const { data, error } = await supabase.rpc('start_dialer_session_v2', {
    p_actor_email: input.actor.email,
    p_agent_name: input.actor.name,
    p_queue_key: input.queueKey.trim() || 'custom',
    p_queue_items: queueItems,
    p_caller_id: input.callerId.trim(),
    p_saved_queue_id: input.savedQueueId || null,
    p_settings_snapshot: input.settings || {},
  })
  if (error) throw mapDatabaseError(error)
  const payload = data as { created?: unknown; session?: unknown } | null
  return { created: payload?.created === true, session: parseDialerSession(payload?.session) }
}

type DialerSessionRow = {
  id: string
  status: string
  actor_email: string
  agent_name: string
  queue_key: string
  saved_queue_id: string | null
  queue_snapshot: unknown
  queue_size: number
  current_index: number
  current_lead_id: string | null
  current_prospect_id: string | null
  current_subject_kind: DialerQueueSubjectKind | null
  current_subject_id: string | null
  current_campaign_member_id: string | null
  caller_id: string | null
  settings_snapshot: unknown
  dials_completed: number
  contacts: number
  skips: number
  outcomes: unknown
  started_at: string
  paused_at: string | null
  stop_requested_at: string | null
  ended_at: string | null
  updated_at: string
  state_version: number
}

function rowToSession(row: DialerSessionRow): DialerSessionState {
  return parseDialerSession({
    id: row.id,
    status: row.status,
    actorEmail: row.actor_email,
    agentName: row.agent_name,
    queueKey: row.queue_key,
    savedQueueId: row.saved_queue_id,
    leadIds: Array.isArray(row.queue_snapshot) ? row.queue_snapshot.filter(isUuid) : [],
    queueItems: row.queue_snapshot,
    queueSize: row.queue_size,
    currentIndex: row.current_index,
    currentLeadId: row.current_lead_id,
    currentProspectId: row.current_prospect_id,
    currentSubjectKind: row.current_subject_kind,
    currentSubjectId: row.current_subject_id,
    currentCampaignMemberId: row.current_campaign_member_id,
    callerId: row.caller_id,
    settingsSnapshot: row.settings_snapshot,
    dialsCompleted: row.dials_completed,
    contacts: row.contacts,
    skips: row.skips,
    outcomes: row.outcomes,
    startedAt: row.started_at,
    pausedAt: row.paused_at,
    stopRequestedAt: row.stop_requested_at,
    endedAt: row.ended_at,
    updatedAt: row.updated_at,
    stateVersion: row.state_version,
  })
}

const SESSION_SELECT = 'id,status,actor_email,agent_name,queue_key,saved_queue_id,queue_snapshot,queue_size,current_index,current_lead_id,current_prospect_id,current_subject_kind,current_subject_id,current_campaign_member_id,caller_id,settings_snapshot,dials_completed,contacts,skips,outcomes,started_at,paused_at,stop_requested_at,ended_at,updated_at,state_version'

type HistoryCursor = { timestamp: string; id: string }

function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeHistoryCursor(value: string | null): HistoryCursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<HistoryCursor>
    if (!parsed.timestamp || !parsed.id || !isUuid(parsed.id) || Number.isNaN(Date.parse(parsed.timestamp))) {
      throw new Error('invalid cursor')
    }
    return { timestamp: parsed.timestamp, id: parsed.id }
  } catch {
    throw new DialerSessionError('invalid_cursor', 400, 'Dialer history cursor is invalid')
  }
}

function historyLimit(value: number | undefined, maximum: number): number {
  if (value == null) return Math.min(20, maximum)
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new DialerSessionError('invalid_limit', 400, `Dialer history limit must be between 1 and ${maximum}`)
  }
  return value
}

export async function getDialerSessionHistory(
  actor: AuthenticatedActor,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<DialerHistoryPage<DialerSessionState>> {
  const limit = historyLimit(options.limit, 20)
  const cursor = decodeHistoryCursor(options.cursor || null)
  let query = supabase
    .from('dialer_sessions')
    .select(SESSION_SELECT)
    .eq('actor_email', actor.email.trim().toLowerCase())
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (cursor) {
    query = query.or(`updated_at.lt.${cursor.timestamp},and(updated_at.eq.${cursor.timestamp},id.lt.${cursor.id})`)
  }
  const { data, error } = await query
  if (error) throw mapDatabaseError(error)
  const rows = (data || []) as DialerSessionRow[]
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit).map(rowToSession)
  const last = items.at(-1)
  return {
    items,
    pageInfo: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodeHistoryCursor({ timestamp: last.updatedAt, id: last.id }) : null,
    },
  }
}

type DialerAttemptRow = DialerAttemptState & DialerPostCallRow

export async function getDialerAttemptHistory(
  actor: AuthenticatedActor,
  sessionId: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<{ session: DialerSessionState; attempts: DialerHistoryPage<DialerAttemptHistoryItem> }> {
  const session = await getDialerSession(actor, sessionId)
  const limit = historyLimit(options.limit, 50)
  const cursor = decodeHistoryCursor(options.cursor || null)
  let query = supabase
    .from('dialer_session_attempts')
    .select('id,session_id,client_attempt_id,subject_kind,subject_id,campaign_member_id,lead_id,prospect_id,prospect_phone_id,phone,caller_id,status,disposition,duration_seconds,reached,started_at,connected_at,ended_at,dispositioned_at,advanced_at,created_at,updated_at,post_call_status,post_call_summary,post_call_snapshot,post_call_completed_at,post_call_updated_at,recording_sid,provider_call_sid')
    .eq('session_id', session.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (cursor) {
    query = query.or(`created_at.lt.${cursor.timestamp},and(created_at.eq.${cursor.timestamp},id.lt.${cursor.id})`)
  }
  const { data, error } = await query
  if (error) throw mapDatabaseError(error)
  const rows = ((data || []) as DialerAttemptRow[]).slice(0, limit)
  const leadIds = Array.from(new Set(rows.flatMap((row) => row.lead_id ? [row.lead_id] : [])))
  const prospectIds = Array.from(new Set(rows.flatMap((row) => row.prospect_id ? [row.prospect_id] : [])))
  const proposalLookup = new Map<string, AiChangeProposal>()
  if (rows.length > 0) {
    const { data: proposals, error: proposalError } = await supabase
      .from('ai_change_proposals')
      .select('dialer_session_attempt_id,id,status,summary,proposed_changes,base_snapshot,decided_by,decision_note,decided_at,applied_at,error_code')
      .in('dialer_session_attempt_id', rows.map((row) => row.id))
    if (proposalError) throw mapDatabaseError(proposalError)
    for (const proposalRow of proposals || []) {
      const parsed = parseAiChangeProposal(proposalRow)
      if (parsed && proposalRow.dialer_session_attempt_id) proposalLookup.set(proposalRow.dialer_session_attempt_id, parsed)
    }
  }
  const leadLookup = new Map<string, { full_name: string | null; property_address: string | null }>()
  const prospectLookup = new Map<string, { owner_1: string | null; situs_street: string | null; situs_city: string | null; situs_state: string | null; situs_zip: string | null }>()
  if (leadIds.length > 0) {
    const { data: leads, error: leadError } = await supabase
      .from('leads')
      .select('id,full_name,property_address')
      .in('id', leadIds)
    if (leadError) throw mapDatabaseError(leadError)
    for (const lead of leads || []) leadLookup.set(lead.id, lead)
  }
  if (prospectIds.length > 0) {
    const { data: prospects, error: prospectError } = await supabase
      .from('prospects')
      .select('id,owner_1,situs_street,situs_city,situs_state,situs_zip')
      .in('id', prospectIds)
    if (prospectError) throw mapDatabaseError(prospectError)
    for (const prospect of prospects || []) prospectLookup.set(prospect.id, prospect)
  }
  const items = rows.map((row) => ({
      id: row.id,
      session_id: row.session_id,
      client_attempt_id: row.client_attempt_id,
      subject_kind: row.subject_kind,
      subject_id: row.subject_id,
      campaign_member_id: row.campaign_member_id,
      lead_id: row.lead_id,
      prospect_id: row.prospect_id,
      prospect_phone_id: row.prospect_phone_id,
      phone: row.phone,
      caller_id: row.caller_id,
      status: row.status,
      disposition: row.disposition,
      duration_seconds: row.duration_seconds,
      reached: row.reached,
      started_at: row.started_at,
      connected_at: row.connected_at,
      ended_at: row.ended_at,
      dispositioned_at: row.dispositioned_at,
      advanced_at: row.advanced_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      leadName: row.lead_id
        ? leadLookup.get(row.lead_id)?.full_name || null
        : row.prospect_id ? prospectLookup.get(row.prospect_id)?.owner_1 || null : null,
      propertyAddress: row.lead_id
        ? leadLookup.get(row.lead_id)?.property_address || null
        : row.prospect_id
          ? [prospectLookup.get(row.prospect_id)?.situs_street, prospectLookup.get(row.prospect_id)?.situs_city, prospectLookup.get(row.prospect_id)?.situs_state, prospectLookup.get(row.prospect_id)?.situs_zip].filter(Boolean).join(', ') || null
          : null,
      postCallReview: parseDialerPostCallReview(row, proposalLookup.get(row.id) || null),
  }))
  const hasMore = ((data || []) as DialerAttemptRow[]).length > limit
  const last = items.at(-1)
  return {
    session,
    attempts: {
      items,
      pageInfo: {
        limit,
        hasMore,
        nextCursor: hasMore && last ? encodeHistoryCursor({ timestamp: last.created_at, id: last.id }) : null,
      },
    },
  }
}

export async function getDialerSession(actor: AuthenticatedActor, sessionId: string): Promise<DialerSessionState> {
  if (!isUuid(sessionId)) throw new DialerSessionError('invalid_session_id', 400, 'Dialer session is invalid')
  const { data, error } = await supabase
    .from('dialer_sessions')
    .select(SESSION_SELECT)
    .eq('id', sessionId)
    .eq('actor_email', actor.email)
    .maybeSingle()
  if (error) throw mapDatabaseError(error)
  if (!data) throw new DialerSessionError('session_not_found', 404, 'Dialer session not found')
  return rowToSession(data as DialerSessionRow)
}

export async function getOpenDialerSession(actor: AuthenticatedActor): Promise<DialerSessionState | null> {
  const { data, error } = await supabase
    .from('dialer_sessions')
    .select(SESSION_SELECT)
    .eq('actor_email', actor.email)
    .in('status', ['active', 'paused'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw mapDatabaseError(error)
  return data ? rowToSession(data as DialerSessionRow) : null
}

export async function transitionDialerSession(input: {
  actor: AuthenticatedActor
  sessionId: string
  action: 'pause' | 'resume' | 'request_stop' | 'stop' | 'skip'
  reason?: string | null
}): Promise<DialerSessionState> {
  if (!isUuid(input.sessionId)) throw new DialerSessionError('invalid_session_id', 400, 'Dialer session is invalid')
  const { data, error } = await supabase.rpc('transition_dialer_session_v1', {
    p_session_id: input.sessionId,
    p_actor_email: input.actor.email,
    p_action: input.action,
    p_reason: input.reason?.trim() || null,
  })
  if (error) throw mapDatabaseError(error)
  return parseDialerSession(data)
}

export async function requestPauseDialerSession(input: {
  actor: AuthenticatedActor
  sessionId: string
  reason?: string | null
}): Promise<{ session: DialerSessionState; requiresDisposition: boolean }> {
  if (!isUuid(input.sessionId)) throw new DialerSessionError('invalid_session_id', 400, 'Dialer session is invalid')
  const { data, error } = await supabase.rpc('request_pause_dialer_session_v1', {
    p_session_id: input.sessionId,
    p_actor_email: input.actor.email,
    p_reason: input.reason?.trim() || null,
  })
  if (error) throw mapDatabaseError(error)
  const result = data as { session?: unknown; requiresDisposition?: unknown } | null
  return {
    session: parseDialerSession(result?.session),
    requiresDisposition: result?.requiresDisposition === true,
  }
}

export async function authorizeDialerSessionAttempt(input: {
  actor: AuthenticatedActor
  sessionId: string
  clientAttemptId: string
  subjectKind: DialerQueueSubjectKind
  subjectId: string
  campaignMemberId: string | null
  leadId: string | null
  prospectId: string | null
  prospectPhoneId: string | null
  phone: string
  callerId: string
}): Promise<DialerAttemptState> {
  if (!isUuid(input.sessionId) || !isUuid(input.subjectId)
    || (input.campaignMemberId && !isUuid(input.campaignMemberId))
    || (input.leadId && !isUuid(input.leadId)) || (input.prospectId && !isUuid(input.prospectId))
    || (input.prospectPhoneId && !isUuid(input.prospectPhoneId))
    || (input.subjectKind === 'lead' && (input.leadId !== input.subjectId || input.prospectId))
    || (input.subjectKind === 'prospect' && (input.prospectId !== input.subjectId || input.leadId || !input.prospectPhoneId))) {
    throw new DialerSessionError('invalid_attempt_context', 400, 'Call context is invalid')
  }
  const { data, error } = await supabase.rpc('authorize_dialer_attempt_v3', {
    p_session_id: input.sessionId,
    p_actor_email: input.actor.email,
    p_client_attempt_id: input.clientAttemptId,
    p_subject_kind: input.subjectKind,
    p_subject_id: input.subjectId,
    p_campaign_member_id: input.campaignMemberId,
    p_lead_id: input.leadId,
    p_prospect_id: input.prospectId,
    p_prospect_phone_id: input.prospectPhoneId,
    p_phone: input.phone,
    p_caller_id: input.callerId,
  })
  if (error) throw mapDatabaseError(error)
  return data as DialerAttemptState
}

export async function transitionDialerAttempt(input: {
  actor: AuthenticatedActor
  sessionId: string
  clientAttemptId: string
  action: 'started' | 'connected' | 'ended' | 'failed' | 'cancelled' | 'disposition'
  disposition?: string | null
  durationSeconds?: number | null
  reached?: boolean | null
}): Promise<DialerAttemptState> {
  if (!isUuid(input.sessionId) || !input.clientAttemptId.trim()) throw new DialerSessionError('invalid_attempt_context', 400, 'Call attempt is invalid')
  const { data, error } = await supabase.rpc('transition_dialer_attempt_v1', {
    p_session_id: input.sessionId,
    p_actor_email: input.actor.email,
    p_client_attempt_id: input.clientAttemptId,
    p_action: input.action,
    p_disposition: input.disposition?.trim() || null,
    p_duration_seconds: input.durationSeconds == null ? null : Math.max(0, Math.round(input.durationSeconds)),
    p_reached: input.reached ?? null,
  })
  if (error) throw mapDatabaseError(error)
  return data as DialerAttemptState
}

export async function advanceDialerSessionAfterDisposition(input: {
  actor: AuthenticatedActor
  sessionId: string
  clientAttemptId: string
}): Promise<DialerSessionState> {
  if (!isUuid(input.sessionId) || !input.clientAttemptId.trim()) throw new DialerSessionError('invalid_attempt_context', 400, 'Call attempt is invalid')
  const { data, error } = await supabase.rpc('advance_dialer_session_v1', {
    p_session_id: input.sessionId,
    p_actor_email: input.actor.email,
    p_client_attempt_id: input.clientAttemptId,
  })
  if (error) throw mapDatabaseError(error)
  return parseDialerSession(data)
}
