import 'server-only'

import { isSavingKcWorkday } from '@/lib/company-calendar'
import { normalizeMojoPerformanceSnapshot, type MojoPerformanceSnapshot } from '@/lib/server/mojo-performance'
import { fetchMojoPerformanceSnapshot } from '@/lib/server/mojo-kpi-provider.mjs'
import type { supabaseAdmin } from '@/lib/supabase/admin'

type SupabaseLike = Pick<ReturnType<typeof supabaseAdmin>, 'from' | 'rpc'>

type FetchSnapshot = (options: {
  sessionId: string
  providerAgentId: string
  agentKey: string
  metricDate: string
  fetchedAt: Date
}) => Promise<unknown>

export type MojoPerformanceSyncCode =
  | 'session_store_unavailable'
  | 'session_missing'
  | 'session_expired'
  | 'provider_unavailable'
  | 'projection_unavailable'

export type MojoPerformanceSyncResult = {
  ok: true
  skipped: boolean
  reason?: 'outside_business_hours'
  metricDate: string
  sourceFetchedAt?: string
  applied?: boolean
  attempts?: number
  calls?: number
  contacts?: number
  leads?: number
  appointments?: number
}

export class MojoPerformanceSyncError extends Error {
  constructor(
    public readonly code: MojoPerformanceSyncCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'MojoPerformanceSyncError'
  }
}

const TIME_ZONE = 'America/Chicago'
const DEFAULT_PROVIDER_AGENT_ID = '1'
const DEFAULT_AGENT_KEY = 'casey'
const MAX_PROVIDER_ATTEMPTS = 3

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function mojoCentralDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

export function isMojoBusinessHours(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  return isSavingKcWorkday(mojoCentralDateKey(now)) && hour >= 8 && hour < 18
}

function sessionFromValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return text((value as Record<string, unknown>).sessionId) || null
}

async function loadStoredSession(db: SupabaseLike): Promise<string> {
  const environmentSession = text(process.env.MOJO_SESSION_ID)
  const { data, error } = await db
    .from('system_config')
    .select('value')
    .eq('key', 'mojo_session_id')
    .maybeSingle()

  if (error) {
    if (environmentSession) return environmentSession
    throw new MojoPerformanceSyncError(
      'session_store_unavailable',
      `Stored Mojo session could not be read: ${error.message}`,
    )
  }

  const sessionId = sessionFromValue(data?.value)
  if (sessionId) return sessionId
  if (environmentSession) return environmentSession
  throw new MojoPerformanceSyncError('session_missing', 'No stored Mojo session is available')
}

async function persistState(
  db: SupabaseLike,
  values: Record<string, string>,
  now: Date,
): Promise<void> {
  const rows = Object.entries(values).map(([key, value]) => ({
    key,
    value,
    updated_at: now.toISOString(),
  }))
  const { error } = await db.from('system_config').upsert(rows, { onConflict: 'key' })
  if (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'mojo_performance_state_write_failed',
      error: error.message,
    }))
  }
}

function isSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /session_expired|session is required|login/i.test(message)
}

async function providerSnapshotWithRetry(options: {
  sessionId: string
  providerAgentId: string
  agentKey: string
  metricDate: string
  now: Date
  fetchSnapshot: FetchSnapshot
  sleep: (milliseconds: number) => Promise<void>
}): Promise<{ snapshot: MojoPerformanceSnapshot; attempts: number }> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    try {
      const snapshot = normalizeMojoPerformanceSnapshot(await options.fetchSnapshot({
        sessionId: options.sessionId,
        providerAgentId: options.providerAgentId,
        agentKey: options.agentKey,
        metricDate: options.metricDate,
        fetchedAt: options.now,
      }))
      return { snapshot, attempts: attempt }
    } catch (error) {
      lastError = error
      if (isSessionError(error) || attempt === MAX_PROVIDER_ATTEMPTS) break
      await options.sleep(attempt * 250)
    }
  }

  if (isSessionError(lastError)) {
    throw new MojoPerformanceSyncError(
      'session_expired',
      'The stored Mojo session is no longer valid',
      { cause: lastError },
    )
  }
  throw new MojoPerformanceSyncError(
    'provider_unavailable',
    `Mojo KPI could not be read after ${MAX_PROVIDER_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message.slice(0, 250) : 'unknown provider error'}`,
    { cause: lastError },
  )
}

export async function syncCurrentMojoPerformance(options: {
  db: SupabaseLike
  now?: Date
  force?: boolean
  providerAgentId?: string
  agentKey?: string
  fetchSnapshot?: FetchSnapshot
  sleep?: (milliseconds: number) => Promise<void>
}): Promise<MojoPerformanceSyncResult> {
  const now = options.now ?? new Date()
  const metricDate = mojoCentralDateKey(now)
  if (!options.force && !isMojoBusinessHours(now)) {
    return { ok: true, skipped: true, reason: 'outside_business_hours', metricDate }
  }

  const providerAgentId = text(options.providerAgentId || process.env.MOJO_PROVIDER_AGENT_ID)
    || DEFAULT_PROVIDER_AGENT_ID
  const agentKey = text(options.agentKey || process.env.MOJO_AGENT_KEY).toLowerCase()
    || DEFAULT_AGENT_KEY
  const fetchSnapshot = options.fetchSnapshot ?? fetchMojoPerformanceSnapshot as FetchSnapshot
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)))

  try {
    const sessionId = await loadStoredSession(options.db)
    const { snapshot, attempts } = await providerSnapshotWithRetry({
      sessionId,
      providerAgentId,
      agentKey,
      metricDate,
      now,
      fetchSnapshot,
      sleep,
    })
    const { data, error } = await options.db.rpc('upsert_mojo_agent_daily_performance_v1', {
      p_snapshot: snapshot,
    })
    if (error) {
      throw new MojoPerformanceSyncError(
        'projection_unavailable',
        `Mojo performance snapshot could not be stored: ${error.message}`,
      )
    }

    await persistState(options.db, {
      mojo_performance_sync_health: 'healthy',
      mojo_performance_sync_last_ok_at: now.toISOString(),
      mojo_performance_sync_last_error: '',
      mojo_performance_sync_last_error_at: '',
      mojo_session_status: 'healthy',
      mojo_session_last_ok_at: now.toISOString(),
      mojo_session_last_error: '',
    }, now)

    return {
      ok: true,
      skipped: false,
      metricDate: snapshot.metricDate,
      sourceFetchedAt: snapshot.sourceFetchedAt,
      applied: Boolean(data?.applied),
      attempts,
      calls: snapshot.calls,
      contacts: snapshot.contacts,
      leads: snapshot.leads,
      appointments: snapshot.appointments,
    }
  } catch (error) {
    const syncError = error instanceof MojoPerformanceSyncError
      ? error
      : new MojoPerformanceSyncError('provider_unavailable', 'Mojo performance sync failed', { cause: error })
    const state: Record<string, string> = {
      mojo_performance_sync_health: 'down',
      mojo_performance_sync_last_error: syncError.message,
      mojo_performance_sync_last_error_at: now.toISOString(),
    }
    if (syncError.code === 'session_expired' || syncError.code === 'session_missing') {
      state.mojo_session_status = syncError.code === 'session_expired' ? 'expired' : 'missing'
      state.mojo_session_last_error = syncError.message
      state.mojo_session_last_error_at = now.toISOString()
    }
    await persistState(options.db, state, now)
    throw syncError
  }
}
