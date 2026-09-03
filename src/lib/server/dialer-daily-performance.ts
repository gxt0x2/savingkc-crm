import { centralMidnightUtc, MY_DAY_TIME_ZONE, shiftMyDayDate } from '@/lib/my-day-range'
import { supabaseAdmin } from '@/lib/supabase/admin'

export { centralMidnightUtc } from '@/lib/my-day-range'

const MAX_RANGE_DAYS = 90
const MAX_SESSIONS = 1_000
const MAX_ACTIVITY_ROWS = 20_000
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const CENTRAL_DATE_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: MY_DAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

interface DialerSessionRow {
  id: string
  started_at: string
  ended_at: string | null
  paused_at: string | null
  last_interaction_at: string
  idle_timeout_seconds: number
  status: string
}

interface DialerSessionEventRow {
  session_id: string
  event_type: string
  created_at: string
}

interface DialerSessionAttemptRow {
  session_id: string
  created_at: string
  started_at: string | null
  connected_at: string | null
  ended_at: string | null
  dispositioned_at: string | null
  reached: boolean | null
}

interface AssignedLeadRow {
  created_at: string
}

export interface DialerDailyPerformanceRow {
  metric_date: string
  dialing_seconds: number
  calls: number
  contacts: number
  leads: number
}

export interface DialerPerformanceSummary {
  generatedAt: string
  timeZone: typeof MY_DAY_TIME_ZONE
  rows: DialerDailyPerformanceRow[]
}

interface SummarizeDialerPerformanceInput {
  from: string
  to: string
  now: Date
  sessions: DialerSessionRow[]
  events: DialerSessionEventRow[]
  attempts: DialerSessionAttemptRow[]
  leads: AssignedLeadRow[]
}

function dateKey(value: Date): string {
  return CENTRAL_DATE_KEY.format(value)
}

function validDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false
  return new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
}

function rangeDateKeys(from: string, to: string): string[] {
  if (!validDateKey(from) || !validDateKey(to) || from > to) throw new Error('Invalid dialer performance range')
  const values: string[] = []
  for (let value = from; value <= to; value = shiftMyDayDate(value, 1)) {
    values.push(value)
    if (values.length > MAX_RANGE_DAYS) throw new Error('Dialer performance range exceeds 90 days')
  }
  return values
}

function validTime(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function addActiveInterval(
  rows: Map<string, DialerDailyPerformanceRow>,
  startMs: number,
  endMs: number,
) {
  let cursor = startMs
  while (cursor < endMs) {
    const key = dateKey(new Date(cursor))
    const row = rows.get(key)
    const nextBoundary = centralMidnightUtc(shiftMyDayDate(key, 1)).getTime()
    const intervalEnd = Math.min(endMs, nextBoundary)
    if (row) row.dialing_seconds += Math.max(0, Math.round((intervalEnd - cursor) / 1_000))
    cursor = intervalEnd
  }
}

export function summarizeDialerPerformance(input: SummarizeDialerPerformanceInput): DialerPerformanceSummary {
  const keys = rangeDateKeys(input.from, input.to)
  const rows = new Map(keys.map((metricDate) => [metricDate, {
    metric_date: metricDate,
    dialing_seconds: 0,
    calls: 0,
    contacts: 0,
    leads: 0,
  }]))
  const rangeStart = centralMidnightUtc(input.from).getTime()
  const rangeEnd = centralMidnightUtc(shiftMyDayDate(input.to, 1)).getTime()
  const summaryEnd = Math.min(rangeEnd, input.now.getTime())
  const eventsBySession = new Map<string, DialerSessionEventRow[]>()
  for (const event of input.events) {
    const values = eventsBySession.get(event.session_id) ?? []
    values.push(event)
    eventsBySession.set(event.session_id, values)
  }
  const attemptsBySession = new Map<string, DialerSessionAttemptRow[]>()
  for (const attempt of input.attempts) {
    const values = attemptsBySession.get(attempt.session_id) ?? []
    values.push(attempt)
    attemptsBySession.set(attempt.session_id, values)
  }

  for (const session of input.sessions) {
    const sessionStart = validTime(session.started_at)
    if (sessionStart === null || sessionStart >= summaryEnd) continue
    const sessionEnd = Math.min(validTime(session.ended_at) ?? summaryEnd, summaryEnd)
    if (sessionEnd <= rangeStart) continue
    const idleTimeoutMs = Math.max(1, session.idle_timeout_seconds || 300) * 1_000
    const timeline: Array<{ at: number; type: 'activity' | 'call_start' | 'call_end' | 'pause' | 'resume' | 'stop' }> = []
    for (const event of eventsBySession.get(session.id) ?? []) {
      const at = validTime(event.created_at)
      if (at === null) continue
      if (['session_pause', 'session_pause_requested', 'session_idle_stop_requested'].includes(event.event_type)) timeline.push({ at, type: 'pause' })
      else if (['session_stop', 'session_idle_timeout'].includes(event.event_type)) timeline.push({ at, type: 'stop' })
      else if (['session_resume', 'session_started'].includes(event.event_type)) timeline.push({ at, type: 'resume' })
      else timeline.push({ at, type: 'activity' })
    }
    for (const attempt of attemptsBySession.get(session.id) ?? []) {
      for (const value of [attempt.created_at, attempt.started_at, attempt.dispositioned_at]) {
        const at = validTime(value)
        if (at !== null) timeline.push({ at, type: 'activity' })
      }
      const connectedAt = validTime(attempt.connected_at)
      const endedAt = validTime(attempt.ended_at)
      if (connectedAt !== null) timeline.push({ at: connectedAt, type: 'call_start' })
      if (endedAt !== null) timeline.push({ at: endedAt, type: 'call_end' })
    }
    if (session.status === 'paused' && session.paused_at) {
      const pausedAt = validTime(session.paused_at)
      if (pausedAt !== null && !timeline.some((event) => event.type === 'pause' && event.at === pausedAt)) {
        timeline.push({ at: pausedAt, type: 'pause' })
      }
    }
    timeline.sort((left, right) => left.at - right.at)

    let sessionOpen = true
    let callActive = false
    let cursor = sessionStart
    let idleDeadline = sessionStart + idleTimeoutMs
    const accrueUntil = (at: number) => {
      if (!sessionOpen || at <= cursor) return
      const activeEnd = callActive ? at : Math.min(at, idleDeadline)
      if (cursor < activeEnd) addActiveInterval(rows, cursor, activeEnd)
      cursor = at
    }
    for (const event of timeline) {
      if (event.at < sessionStart) continue
      if (event.at >= sessionEnd) break
      accrueUntil(event.at)
      if (event.type === 'pause' || event.type === 'stop') {
        sessionOpen = false
        callActive = false
      } else if (event.type === 'resume') {
        sessionOpen = true
        callActive = false
        cursor = event.at
        idleDeadline = event.at + idleTimeoutMs
      } else if (event.type === 'call_start' && sessionOpen) {
        callActive = true
        idleDeadline = Math.max(idleDeadline, event.at + idleTimeoutMs)
      } else if (event.type === 'call_end' && sessionOpen) {
        callActive = false
        idleDeadline = event.at + idleTimeoutMs
      } else if (event.type === 'activity' && sessionOpen) {
        idleDeadline = event.at + idleTimeoutMs
      }
    }
    accrueUntil(sessionEnd)
  }

  for (const attempt of input.attempts) {
    const startedAt = validTime(attempt.started_at)
    if (startedAt === null) continue
    const row = rows.get(dateKey(new Date(startedAt)))
    if (!row) continue
    row.calls += 1
    if (attempt.reached === true) row.contacts += 1
  }
  for (const lead of input.leads) {
    const createdAt = validTime(lead.created_at)
    if (createdAt === null) continue
    const row = rows.get(dateKey(new Date(createdAt)))
    if (row) row.leads += 1
  }

  return { generatedAt: input.now.toISOString(), timeZone: MY_DAY_TIME_ZONE, rows: [...rows.values()] }
}

function agentMatch(agentName: string): string {
  const firstName = agentName.trim().split(/\s+/)[0] || agentName.trim()
  return `%${firstName.replaceAll('%', '').replaceAll('_', '')}%`
}

export async function loadDialerDailyPerformance(input: {
  actorEmail: string
  agentName: string
  from: string
  to: string
  now?: Date
  includeLeads?: boolean
}): Promise<DialerPerformanceSummary> {
  rangeDateKeys(input.from, input.to)
  const now = input.now ?? new Date()
  const rangeStart = centralMidnightUtc(input.from).toISOString()
  const rangeEnd = centralMidnightUtc(shiftMyDayDate(input.to, 1)).toISOString()
  const db = supabaseAdmin()
  const sessionQuery = db
    .from('dialer_sessions')
    .select('id, started_at, ended_at, paused_at, last_interaction_at, idle_timeout_seconds, status')
    .ilike('actor_email', input.actorEmail.trim().toLowerCase())
    .lt('started_at', rangeEnd)
    .or(`ended_at.is.null,ended_at.gte.${rangeStart}`)
    .order('started_at', { ascending: true })
    .limit(MAX_SESSIONS)
  const leadsQuery = input.includeLeads === false
    ? Promise.resolve({ data: [] as AssignedLeadRow[], error: null })
    : db
      .from('leads')
      .select('created_at')
      .ilike('assigned_agent', agentMatch(input.agentName))
      .gte('created_at', rangeStart)
      .lt('created_at', rangeEnd)
      .limit(MAX_ACTIVITY_ROWS)
  const [sessionResult, leadsResult] = await Promise.all([sessionQuery, leadsQuery])
  if (sessionResult.error) throw new Error(`Dialer sessions unavailable: ${sessionResult.error.message}`)
  if (leadsResult.error) throw new Error(`Assigned leads unavailable: ${leadsResult.error.message}`)
  const sessions = (sessionResult.data ?? []) as DialerSessionRow[]
  if (sessions.length >= MAX_SESSIONS) throw new Error('Dialer session result exceeded its safety bound')
  if ((leadsResult.data?.length ?? 0) >= MAX_ACTIVITY_ROWS) throw new Error('Assigned lead result exceeded its safety bound')
  const sessionIds = sessions.map((session) => session.id)
  let events: DialerSessionEventRow[] = []
  let attempts: DialerSessionAttemptRow[] = []
  if (sessionIds.length > 0) {
    const [eventResult, attemptResult] = await Promise.all([
      db.from('dialer_session_events')
        .select('session_id, event_type, created_at')
        .in('session_id', sessionIds)
        .lt('created_at', rangeEnd)
        .order('created_at', { ascending: true })
        .limit(MAX_ACTIVITY_ROWS),
      db.from('dialer_session_attempts')
        .select('session_id, created_at, started_at, connected_at, ended_at, dispositioned_at, reached')
        .in('session_id', sessionIds)
        .gte('started_at', rangeStart)
        .lt('started_at', rangeEnd)
        .order('started_at', { ascending: true })
        .limit(MAX_ACTIVITY_ROWS),
    ])
    if (eventResult.error) throw new Error(`Dialer session events unavailable: ${eventResult.error.message}`)
    if (attemptResult.error) throw new Error(`Dialer attempts unavailable: ${attemptResult.error.message}`)
    if ((eventResult.data?.length ?? 0) >= MAX_ACTIVITY_ROWS || (attemptResult.data?.length ?? 0) >= MAX_ACTIVITY_ROWS) {
      throw new Error('Dialer activity result exceeded its safety bound')
    }
    events = (eventResult.data ?? []) as DialerSessionEventRow[]
    attempts = (attemptResult.data ?? []) as DialerSessionAttemptRow[]
  }
  return summarizeDialerPerformance({
    from: input.from,
    to: input.to,
    now,
    sessions,
    events,
    attempts,
    leads: (leadsResult.data ?? []) as AssignedLeadRow[],
  })
}
