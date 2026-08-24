export const MOJO_PERFORMANCE_SOURCE = 'mojo_kpi_historical_daily_v1' as const
export const MOJO_PERFORMANCE_TIME_ZONE = 'America/Chicago' as const

export type MojoPerformanceSnapshot = {
  agentKey: string
  metricDate: string
  providerAgentId: string
  providerTimezone: typeof MOJO_PERFORMANCE_TIME_ZONE
  dialingSeconds: number
  inProgressSeconds: number
  calls: number
  contacts: number
  leads: number
  appointments: number
  source: typeof MOJO_PERFORMANCE_SOURCE
  sourceDigest: string
  sourceFetchedAt: string
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function boundedCount(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100_000 ? parsed : null
}

function boundedSeconds(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 172_800) return null
  return Math.round(parsed * 1_000) / 1_000
}

function iso(value: unknown): string | null {
  const raw = text(value)
  const parsed = new Date(raw)
  return raw && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

export function normalizeMojoPerformanceSnapshot(value: unknown): MojoPerformanceSnapshot {
  const input = object(value)
  if (!input) throw new Error('invalid_mojo_performance_snapshot')

  const agentKey = text(input.agentKey).toLowerCase()
  const metricDate = text(input.metricDate)
  const providerAgentId = text(input.providerAgentId)
  const providerTimezone = text(input.providerTimezone)
  const source = text(input.source)
  const sourceDigest = text(input.sourceDigest).toLowerCase()
  const sourceFetchedAt = iso(input.sourceFetchedAt)
  const dialingSeconds = boundedSeconds(input.dialingSeconds)
  const inProgressSeconds = boundedSeconds(input.inProgressSeconds)
  const calls = boundedCount(input.calls)
  const contacts = boundedCount(input.contacts)
  const leads = boundedCount(input.leads)
  const appointments = boundedCount(input.appointments)

  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(agentKey)
    || !/^\d{4}-\d{2}-\d{2}$/.test(metricDate)
    || !/^\d{1,32}$/.test(providerAgentId)
    || providerTimezone !== MOJO_PERFORMANCE_TIME_ZONE
    || source !== MOJO_PERFORMANCE_SOURCE
    || !/^[a-f0-9]{64}$/.test(sourceDigest)
    || !sourceFetchedAt
    || dialingSeconds === null
    || inProgressSeconds === null
    || calls === null
    || contacts === null
    || leads === null
    || appointments === null
  ) {
    throw new Error('invalid_mojo_performance_snapshot')
  }

  return {
    agentKey,
    metricDate,
    providerAgentId,
    providerTimezone: MOJO_PERFORMANCE_TIME_ZONE,
    dialingSeconds,
    inProgressSeconds,
    calls,
    contacts,
    leads,
    appointments,
    source: MOJO_PERFORMANCE_SOURCE,
    sourceDigest,
    sourceFetchedAt,
  }
}
