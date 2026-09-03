import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import { centralMidnightUtc, shiftMyDayDate } from '@/lib/my-day-range'
import { supabase } from '@/lib/supabase-lazy'

export interface ProspectingCallReportMetrics {
  sessions: number
  agents: number
  attempts: number
  providerConnected: number
  reached: number
  resultsSaved: number
  failed: number
  uniqueNumbers: number
  durationSeconds: number
  skips: number
}

export interface ProspectingCallReportRun {
  runNumber: number
  sessions: number
  resultsSaved: number
  reached: number
  skips: number
  startedAt: string
  lastActivityAt: string
}

export interface ProspectingCallReportAgent {
  email: string
  name: string
  sessions: number
  resultsSaved: number
  reached: number
  skips: number
}

export interface ProspectingCallReportSession {
  id: string
  campaignId: string
  campaignName: string
  runNumber: number
  agentName: string
  agentEmail: string
  status: string
  queueSize: number
  calls: number
  connected: number
  uniqueNumbers: number
  resultsSaved: number
  reached: number
  skips: number
  durationSeconds: number
  sessionDurationSeconds: number
  outcomes: Record<string, number>
  startedAt: string
  endedAt: string | null
  updatedAt: string
}

export interface ProspectingCallReportAttempt {
  id: string
  sessionId: string
  campaignId: string
  campaignName: string
  runNumber: number
  agentName: string
  agentEmail: string
  sellerName: string | null
  propertyAddress: string | null
  phone: string
  callerId: string
  status: string
  disposition: string | null
  reached: boolean | null
  durationSeconds: number | null
  recordingSid: string | null
  postCallStatus: string | null
  createdAt: string
  startedAt: string | null
  connectedAt: string | null
  endedAt: string | null
}

export const PROSPECTING_CALL_SORTS = ['called', 'campaign', 'seller', 'number', 'result', 'agent', 'run', 'duration', 'caller'] as const
export type ProspectingCallSort = typeof PROSPECTING_CALL_SORTS[number]
export type ProspectingCallSortDirection = 'asc' | 'desc'

export function prospectingCallSort(value: string | null | undefined): ProspectingCallSort {
  return PROSPECTING_CALL_SORTS.includes(value as ProspectingCallSort) ? value as ProspectingCallSort : 'called'
}

export function prospectingCallSortDirection(value: string | null | undefined): ProspectingCallSortDirection {
  return value === 'asc' ? 'asc' : 'desc'
}

export interface ProspectingCallReport {
  campaign: {
    id: string | null
    name: string
    status: string
    currentRunNumber: number | null
  }
  runNumber: number | null
  filters: {
    agentEmail: string | null
    callerId: string | null
    search: string | null
    agents: Array<{ email: string; name: string }>
    callerIds: string[]
  }
  metrics: ProspectingCallReportMetrics
  outcomes: Record<string, number>
  runs: ProspectingCallReportRun[]
  agents: ProspectingCallReportAgent[]
  sessions: ProspectingCallReportSession[]
  attempts: {
    items: ProspectingCallReportAttempt[]
    pageInfo: {
      limit: number
      offset: number
      total: number
      hasMore: boolean
    }
  }
  selectedSessionCalls: ProspectingCallReportAttempt[]
  recordings: {
    items: ProspectingCallReportAttempt[]
    total: number
  }
}

export class ProspectingCallReportError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message)
    this.name = 'ProspectingCallReportError'
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProspectingCallReportError('invalid_report_payload', 503, `${field} report data is unavailable`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProspectingCallReportError('invalid_report_payload', 503, `${field} report data is unavailable`)
  }
  return value.trim()
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function count(value: unknown, field: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ProspectingCallReportError('invalid_report_payload', 503, `${field} report data is unavailable`)
  }
  return parsed
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = count(value, field)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ProspectingCallReportError('invalid_report_payload', 503, `${field} report data is unavailable`)
  }
  return parsed
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function numberRecord(value: unknown): Record<string, number> {
  const source = record(value, 'Outcome')
  return Object.fromEntries(Object.entries(source).map(([key, rawCount]) => [key, count(rawCount, 'Outcome')]))
}

function textArray(value: unknown, field: string): string[] {
  return array(value, field).map((item) => text(item, field))
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ProspectingCallReportError('invalid_report_payload', 503, `${field} report data is unavailable`)
  }
  return value
}

function parseAttempt(value: unknown): ProspectingCallReportAttempt {
  const row = record(value, 'Attempt')
  return {
    id: text(row.id, 'Attempt id'),
    sessionId: text(row.sessionId, 'Attempt session'),
    campaignId: text(row.campaignId, 'Attempt campaign id'),
    campaignName: text(row.campaignName, 'Attempt campaign name'),
    runNumber: positiveInteger(row.runNumber, 'Attempt run'),
    agentName: text(row.agentName, 'Attempt agent'),
    agentEmail: text(row.agentEmail, 'Attempt agent email'),
    sellerName: optionalText(row.sellerName),
    propertyAddress: optionalText(row.propertyAddress),
    phone: text(row.phone, 'Attempt phone'),
    callerId: text(row.callerId, 'Attempt caller id'),
    status: text(row.status, 'Attempt status'),
    disposition: optionalText(row.disposition),
    reached: booleanOrNull(row.reached),
    durationSeconds: row.durationSeconds == null ? null : count(row.durationSeconds, 'Attempt duration'),
    recordingSid: optionalText(row.recordingSid),
    postCallStatus: optionalText(row.postCallStatus),
    createdAt: text(row.createdAt, 'Attempt created time'),
    startedAt: optionalText(row.startedAt),
    connectedAt: optionalText(row.connectedAt),
    endedAt: optionalText(row.endedAt),
  }
}

export function parseProspectingCallReport(value: unknown): ProspectingCallReport {
  const root = record(value, 'Campaign')
  const campaign = record(root.campaign, 'Campaign')
  const metrics = record(root.metrics, 'Metrics')
  const filters = record(root.filters, 'Filter')
  const attempts = record(root.attempts, 'Attempt')
  const pageInfo = record(attempts.pageInfo, 'Page')
  const recordings = record(root.recordings, 'Recording')

  return {
    campaign: {
      id: optionalText(campaign.id),
      name: text(campaign.name, 'Campaign name'),
      status: text(campaign.status, 'Campaign status'),
      currentRunNumber: campaign.currentRunNumber == null ? null : positiveInteger(campaign.currentRunNumber, 'Current run'),
    },
    runNumber: root.runNumber == null ? null : positiveInteger(root.runNumber, 'Run'),
    filters: {
      agentEmail: optionalText(filters.agentEmail),
      callerId: optionalText(filters.callerId),
      search: optionalText(filters.search),
      agents: array(filters.agents, 'Filter agent').map((value) => {
        const row = record(value, 'Filter agent')
        return { email: text(row.email, 'Filter agent email'), name: text(row.name, 'Filter agent name') }
      }),
      callerIds: textArray(filters.callerIds, 'Filter caller id'),
    },
    metrics: {
      sessions: count(metrics.sessions, 'Sessions'),
      agents: count(metrics.agents, 'Agents'),
      attempts: count(metrics.attempts, 'Attempts'),
      providerConnected: count(metrics.providerConnected, 'Provider connects'),
      reached: count(metrics.reached, 'Reached'),
      resultsSaved: count(metrics.resultsSaved, 'Results saved'),
      failed: count(metrics.failed, 'Failed attempts'),
      uniqueNumbers: count(metrics.uniqueNumbers, 'Unique numbers'),
      durationSeconds: count(metrics.durationSeconds, 'Call duration'),
      skips: count(metrics.skips, 'Skips'),
    },
    outcomes: numberRecord(root.outcomes),
    runs: array(root.runs, 'Run').map((value) => {
      const row = record(value, 'Run')
      return {
        runNumber: positiveInteger(row.runNumber, 'Run'),
        sessions: count(row.sessions, 'Run sessions'),
        resultsSaved: count(row.resultsSaved, 'Run results'),
        reached: count(row.reached, 'Run reached'),
        skips: count(row.skips, 'Run skips'),
        startedAt: text(row.startedAt, 'Run start'),
        lastActivityAt: text(row.lastActivityAt, 'Run activity'),
      }
    }),
    agents: array(root.agents, 'Agent').map((value) => {
      const row = record(value, 'Agent')
      return {
        email: text(row.email, 'Agent email'),
        name: text(row.name, 'Agent name'),
        sessions: count(row.sessions, 'Agent sessions'),
        resultsSaved: count(row.resultsSaved, 'Agent results'),
        reached: count(row.reached, 'Agent reached'),
        skips: count(row.skips, 'Agent skips'),
      }
    }),
    sessions: array(root.sessions, 'Session').map((value) => {
      const row = record(value, 'Session')
      return {
        id: text(row.id, 'Session id'),
        campaignId: text(row.campaignId, 'Session campaign id'),
        campaignName: text(row.campaignName, 'Session campaign name'),
        runNumber: positiveInteger(row.runNumber, 'Session run'),
        agentName: text(row.agentName, 'Session agent'),
        agentEmail: text(row.agentEmail, 'Session agent email'),
        status: text(row.status, 'Session status'),
        queueSize: count(row.queueSize, 'Session queue'),
        calls: count(row.calls, 'Session calls'),
        connected: count(row.connected, 'Session connected'),
        uniqueNumbers: count(row.uniqueNumbers, 'Session unique numbers'),
        resultsSaved: count(row.resultsSaved, 'Session results'),
        reached: count(row.reached, 'Session reached'),
        skips: count(row.skips, 'Session skips'),
        durationSeconds: count(row.durationSeconds, 'Session call duration'),
        sessionDurationSeconds: count(row.sessionDurationSeconds, 'Session duration'),
        outcomes: numberRecord(row.outcomes),
        startedAt: text(row.startedAt, 'Session start'),
        endedAt: optionalText(row.endedAt),
        updatedAt: text(row.updatedAt, 'Session update'),
      }
    }),
    attempts: {
      items: array(attempts.items, 'Attempt').map(parseAttempt),
      pageInfo: {
        limit: positiveInteger(pageInfo.limit, 'Page limit'),
        offset: count(pageInfo.offset, 'Page offset'),
        total: count(pageInfo.total, 'Page total'),
        hasMore: pageInfo.hasMore === true,
      },
    },
    selectedSessionCalls: array(root.selectedSessionCalls, 'Session call').map(parseAttempt),
    recordings: {
      items: array(recordings.items, 'Recording').map(parseAttempt),
      total: count(recordings.total, 'Recording total'),
    },
  }
}

function reportDatabaseError(error: { message?: string; code?: string } | null | undefined): ProspectingCallReportError {
  const detail = `${error?.message || ''} ${error?.code || ''}`.toLowerCase()
  if (detail.includes('campaign_not_found')) return new ProspectingCallReportError('campaign_not_found', 404, 'Campaign report not found')
  if (detail.includes('invalid_campaign_kind')) return new ProspectingCallReportError('invalid_campaign_kind', 409, 'Call reporting is available only for dialing campaigns')
  if (detail.includes('invalid_') || detail.includes('22p02')) return new ProspectingCallReportError('invalid_report_request', 400, 'Campaign report filters are invalid')
  if (detail.includes('does not exist') || detail.includes('pgrst202') || detail.includes('42883')) {
    return new ProspectingCallReportError('reporting_unavailable', 503, 'Prospecting call reporting is not available in this environment')
  }
  return new ProspectingCallReportError('reporting_unavailable', 503, 'Prospecting call report could not be loaded')
}

export async function getProspectingCallReport(
  actor: AuthenticatedActor,
  campaignId: string | null,
  options: {
    runNumber?: number | null
    page?: number
    limit?: number
    from?: string | null
    to?: string | null
    agentEmail?: string | null
    callerId?: string | null
    search?: string | null
    sessionId?: string | null
    sort?: ProspectingCallSort
    direction?: ProspectingCallSortDirection
  } = {},
): Promise<ProspectingCallReport> {
  if (campaignId !== null && !UUID_PATTERN.test(campaignId)) throw new ProspectingCallReportError('invalid_campaign_id', 400, 'Campaign id is invalid')
  const runNumber = options.runNumber ?? null
  const page = options.page ?? 1
  const limit = options.limit ?? 50
  const from = options.from ?? null
  const to = options.to ?? null
  const agentEmail = options.agentEmail?.trim() || null
  const callerId = options.callerId?.trim() || null
  const search = options.search?.trim() || null
  const sessionId = options.sessionId?.trim() || null
  const sort = options.sort ?? 'called'
  const direction = options.direction ?? 'desc'
  if ((runNumber !== null && (!Number.isInteger(runNumber) || runNumber < 1))
    || (campaignId === null && runNumber !== null)
    || !Number.isInteger(page) || page < 1
    || !Number.isInteger(limit) || limit < 1 || limit > 100
    || ((from === null) !== (to === null))
    || (from !== null && to !== null && (
      !DATE_KEY_PATTERN.test(from) || !DATE_KEY_PATTERN.test(to) || from > to || shiftMyDayDate(from, 89) < to
    ))
    || (agentEmail !== null && agentEmail.length > 320)
    || (callerId !== null && callerId.length > 32)
    || (search !== null && search.length > 120)
    || (sessionId !== null && !UUID_PATTERN.test(sessionId))
    || !PROSPECTING_CALL_SORTS.includes(sort)
    || !['asc', 'desc'].includes(direction)) {
    throw new ProspectingCallReportError('invalid_report_request', 400, 'Campaign report filters are invalid')
  }

  const { data, error } = await supabase.rpc('prospecting_campaign_call_report_v3', {
    p_campaign_id: campaignId,
    p_actor_email: actor.email,
    p_run_number: runNumber,
    p_from: from === null ? null : centralMidnightUtc(from).toISOString(),
    p_to_exclusive: to === null ? null : centralMidnightUtc(shiftMyDayDate(to, 1)).toISOString(),
    p_agent_email: agentEmail,
    p_caller_id: callerId,
    p_search: search,
    p_session_id: sessionId,
    p_sort: sort,
    p_direction: direction,
    p_limit: limit,
    p_offset: (page - 1) * limit,
  })
  if (error) throw reportDatabaseError(error)
  return parseProspectingCallReport(data)
}
