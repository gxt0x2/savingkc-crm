import { createHash } from 'node:crypto'

export const MOJO_KPI_URL = 'https://app71.mojosells.com/kpi/get_historical_data/'
export const MOJO_PERFORMANCE_SOURCE = 'mojo_kpi_historical_daily_v1'
export const MOJO_PERFORMANCE_TIME_ZONE = 'America/Chicago'

function dateKey(now, timeZone = MOJO_PERFORMANCE_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = (type) => parts.find((part) => part.type === type)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function providerDate(metricDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate)) throw new Error('Invalid Mojo KPI metric date')
  const [year, month, day] = metricDate.split('-')
  return `${month}/${day}/${year}`
}

function normalizeTimezone(value) {
  if (['US/Central', 'America/Chicago', 'CST6CDT'].includes(String(value || '').trim())) {
    return MOJO_PERFORMANCE_TIME_ZONE
  }
  throw new Error('Mojo KPI returned an unexpected timezone')
}

function count(value, field) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100_000) {
    throw new Error(`Mojo KPI returned an invalid ${field}`)
  }
  return parsed
}

function seconds(value, field) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 172_800) {
    throw new Error(`Mojo KPI returned invalid ${field}`)
  }
  return Math.round(parsed * 1_000) / 1_000
}

function digestPayload(snapshot) {
  return JSON.stringify({
    agentKey: snapshot.agentKey,
    metricDate: snapshot.metricDate,
    providerAgentId: snapshot.providerAgentId,
    providerTimezone: snapshot.providerTimezone,
    dialingSeconds: snapshot.dialingSeconds,
    inProgressSeconds: snapshot.inProgressSeconds,
    calls: snapshot.calls,
    contacts: snapshot.contacts,
    leads: snapshot.leads,
    appointments: snapshot.appointments,
    source: snapshot.source,
  })
}

export function mojoPerformanceDatasetDigest(snapshots) {
  const stable = [...snapshots]
    .map((snapshot) => ({
      metricDate: snapshot.metricDate,
      sourceDigest: snapshot.sourceDigest,
    }))
    .sort((left, right) => left.metricDate.localeCompare(right.metricDate))
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

export function buildMojoPerformanceSnapshot(payload, options = {}) {
  const providerAgentId = String(options.providerAgentId || '1').trim()
  const agentKey = String(options.agentKey || 'casey').trim().toLowerCase()
  const fetchedAt = new Date(options.fetchedAt || new Date()).toISOString()
  const metricDate = options.metricDate || dateKey(new Date(fetchedAt))
  const requestedDate = providerDate(metricDate)
  const agent = payload?.data_by_month?.[providerAgentId]
  const rows = Array.isArray(agent?.data) ? agent.data : []
  const metrics = rows.find((row) => row?.month_string === requestedDate)
  if (!agent || !metrics) throw new Error('Mojo KPI response did not include the requested exact-day totals')

  const snapshot = {
    agentKey,
    metricDate,
    providerAgentId,
    providerTimezone: normalizeTimezone(options.providerTimezone || 'America/Chicago'),
    dialingSeconds: seconds(metrics.seconds, 'dialing time'),
    inProgressSeconds: 0,
    calls: count(metrics.calls, 'calls'),
    contacts: count(metrics.contacts, 'contacts'),
    leads: count(metrics.leads, 'leads'),
    appointments: count(metrics.appointments, 'appointments'),
    source: MOJO_PERFORMANCE_SOURCE,
    sourceFetchedAt: fetchedAt,
  }

  return {
    ...snapshot,
    sourceDigest: createHash('sha256').update(digestPayload(snapshot)).digest('hex'),
  }
}

export async function fetchMojoPerformanceSnapshot(options) {
  const {
    sessionId,
    providerAgentId = '1',
    agentKey = 'casey',
    fetchedAt = new Date(),
    metricDate,
    fetchImpl = fetch,
  } = options
  if (!sessionId) throw new Error('Mojo session is required for KPI snapshot')

  const resolvedMetricDate = metricDate || dateKey(new Date(fetchedAt))
  const exactDate = providerDate(resolvedMetricDate)
  const body = new URLSearchParams({
    agents: JSON.stringify([Number(providerAgentId)]),
    caller_ids: '[]',
    start_date: exactDate,
    end_date: exactDate,
  })
  const response = await fetchImpl(MOJO_KPI_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      cookie: `sessionid=${sessionId}`,
      referer: 'https://app71.mojosells.com/kpi/historical_data/',
      'user-agent': 'Mozilla/5.0',
    },
    body,
    signal: AbortSignal.timeout(20_000),
  })
  const contentType = response.headers.get('content-type') || ''
  if (response.status === 401 || response.status === 403 || response.redirected) {
    throw new Error(`session_expired: Mojo KPI request returned ${response.status}`)
  }
  if (!response.ok || response.redirected || !contentType.includes('json')) {
    throw new Error(`Mojo KPI request failed (${response.status})`)
  }

  const payload = await response.json()
  if (payload?.success !== true) throw new Error('Mojo KPI request was not successful')
  return buildMojoPerformanceSnapshot(payload, {
    providerAgentId, agentKey, fetchedAt, metricDate: resolvedMetricDate,
  })
}

export async function storeMojoPerformanceSnapshot(snapshot, options) {
  const { endpoint, headers = {}, fetchImpl = fetch } = options
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(snapshot),
    signal: AbortSignal.timeout(20_000),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok !== true) {
    throw new Error(`CRM Mojo performance write failed (${response.status})`)
  }
  return body
}

export async function syncMojoPerformanceSnapshot(options) {
  const snapshot = await fetchMojoPerformanceSnapshot(options)
  const result = await storeMojoPerformanceSnapshot(snapshot, options)
  return { snapshot, result }
}
