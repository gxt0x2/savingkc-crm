import type { supabaseAdmin } from '@/lib/supabase/admin'
import { isSavingKcWorkday } from '@/lib/company-calendar'

export type MojoHealthStatus = 'clean' | 'watch' | 'attention'

export type MojoHealth = {
  status: MojoHealthStatus
  message: string
  sessionStatus: string
  syncHealth: string
  businessHours: boolean
  lastSyncAt: string | null
  lastSyncAgeMinutes: number | null
  lastSessionOkAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  latestQueuedAt: string | null
  latestCompletedAt: string | null
  latestQueueError: string | null
  performance: {
    status: 'current' | 'delayed' | 'stale' | 'unavailable'
    message: string
    latestMetricDate: string | null
    latestFetchedAt: string | null
    ageMinutes: number | null
    syncHealth: string
    lastOkAt: string | null
    lastError: string | null
    lastErrorAt: string | null
  }
  queue: {
    pending: number
    processing: number
    completed24h: number
    failed24h: number
    deadLetter: number
    queued24h: number
    total7d: number
  }
  qualification: {
    eligible24h: number
    ineligible24h: number
    evidencePending24h: number
    recordingOutstanding24h: number
    recordingFailed7d: number
    analyzed24h: number
  }
  leads: {
    last24h: number
    period: number
    qualifiedPeriod: number
    appointmentPeriod: number
  }
  monitor: {
    path: string
    schedule: string
    manualRefreshCommand: string
  }
}

type SupabaseLike = Pick<ReturnType<typeof supabaseAdmin>, 'from'>

type SystemConfigRow = {
  key: string
  value: unknown
  updated_at?: string | null
}

type MojoQueueRow = {
  status?: string | null
  created_at?: string | null
  completed_at?: string | null
  last_error?: string | null
}

type MojoLeadRow = {
  id: string
  station?: string | null
  created_at?: string | null
}

type MojoPerformanceRow = {
  metric_date?: string | null
  source_fetched_at?: string | null
}

type MojoCallEventRow = {
  call_at?: string | null
  promotion_eligible?: boolean | null
  qualification_status?: string | null
  recording_processing_status?: string | null
}

const SYSTEM_CONFIG_KEYS = [
  'last_mojo_sync_timestamp',
  'mojo_session_last_error',
  'mojo_session_last_error_at',
  'mojo_session_last_ok_at',
  'mojo_session_status',
  'mojo_sync_last_error',
  'mojo_sync_last_error_at',
  'mojo_sync_last_ok_at',
  'mojo_sync_health',
  'mojo_performance_sync_health',
  'mojo_performance_sync_last_ok_at',
  'mojo_performance_sync_last_error',
  'mojo_performance_sync_last_error_at',
]

const QUALIFIED_STATIONS = new Set([
  'qualified',
  'opportunities',
  'opportunity',
  'appointment_set',
  'offer_made',
  'in_closing',
  'under_contract',
  'closed',
])

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function isoOrNull(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function ageMinutes(value: string | null, now: Date): number | null {
  if (!value) return null
  const then = new Date(value).getTime()
  if (!Number.isFinite(then)) return null
  return Math.max(0, Math.round((now.getTime() - then) / 60_000))
}

function latestIso(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null
  for (const value of values) {
    const iso = isoOrNull(value)
    if (!iso) continue
    if (!latest || new Date(iso).getTime() > new Date(latest).getTime()) latest = iso
  }
  return latest
}

function centralBusinessHours(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  return isSavingKcWorkday(centralDateKey(now)) && hour >= 8 && hour < 18
}

function centralDateKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function centralTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function countByStatus(rows: MojoQueueRow[], status: string): number {
  return rows.filter((row) => text(row.status).toLowerCase() === status).length
}

function buildFallbackHealth(error: string, now: Date): MojoHealth {
  return {
    status: 'attention',
    message: `Mojo health monitor failed: ${error}`,
    sessionStatus: 'unknown',
    syncHealth: 'unknown',
    businessHours: centralBusinessHours(now),
    lastSyncAt: null,
    lastSyncAgeMinutes: null,
    lastSessionOkAt: null,
    lastError: error,
    lastErrorAt: now.toISOString(),
    latestQueuedAt: null,
    latestCompletedAt: null,
    latestQueueError: error,
    performance: {
      status: 'unavailable',
      message: `Mojo provider performance health failed: ${error}`,
      latestMetricDate: null,
      latestFetchedAt: null,
      ageMinutes: null,
      syncHealth: 'unknown',
      lastOkAt: null,
      lastError: error,
      lastErrorAt: now.toISOString(),
    },
    queue: {
      pending: 0,
      processing: 0,
      completed24h: 0,
      failed24h: 0,
      deadLetter: 0,
      queued24h: 0,
      total7d: 0,
    },
    qualification: {
      eligible24h: 0,
      ineligible24h: 0,
      evidencePending24h: 0,
      recordingOutstanding24h: 0,
      recordingFailed7d: 0,
      analyzed24h: 0,
    },
    leads: {
      last24h: 0,
      period: 0,
      qualifiedPeriod: 0,
      appointmentPeriod: 0,
    },
    monitor: {
      path: '/api/admin/mojo-health',
      schedule: 'Every 15 minutes during Mojo business hours',
      manualRefreshCommand: 'npm run mojo:session:manual',
    },
  }
}

export function systemWorkerStatus(status: MojoHealthStatus): 'healthy' | 'degraded' | 'down' {
  if (status === 'attention') return 'down'
  if (status === 'watch') return 'degraded'
  return 'healthy'
}

export async function getMojoHealth(
  supabase: SupabaseLike,
  options: {
    now?: Date
    periodSinceIso?: string
    periodUntilIso?: string
  } = {},
): Promise<MojoHealth> {
  const now = options.now ?? new Date()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const periodSinceIso = options.periodSinceIso ?? since7d
  const periodUntilIso = options.periodUntilIso ?? now.toISOString()

  try {
    const [
      { data: configRows, error: configError },
      { data: queueRows, error: queueError },
      { data: callEventRows, error: callEventError },
      { data: periodLeadRows, error: periodLeadError },
      { data: recentLeadRows, error: recentLeadError },
      { data: performanceRows, error: performanceError },
    ] = await Promise.all([
      supabase
        .from('system_config')
        .select('key,value,updated_at')
        .in('key', SYSTEM_CONFIG_KEYS),
      supabase
        .from('mojo_call_queue')
        .select('status,created_at,completed_at,last_error')
        .gte('created_at', since7d)
        .order('created_at', { ascending: false })
        .limit(2000),
      supabase
        .from('crm_mojo_call_events')
        .select('call_at,promotion_eligible,qualification_status,recording_processing_status')
        .gte('call_at', since7d)
        .order('call_at', { ascending: false })
        .limit(5000),
      supabase
        .from('leads')
        .select('id,station,created_at')
        .eq('source', 'mojo_call')
        .gte('created_at', periodSinceIso)
        .lt('created_at', periodUntilIso)
        .limit(2000),
      supabase
        .from('leads')
        .select('id,station,created_at')
        .eq('source', 'mojo_call')
        .gte('created_at', since24h)
        .limit(500),
      supabase
        .from('mojo_agent_daily_performance')
        .select('metric_date,source_fetched_at')
        .eq('agent_key', 'casey')
        .order('metric_date', { ascending: false })
        .limit(1),
    ])

    const firstError = configError || queueError || callEventError || periodLeadError || recentLeadError || performanceError
    if (firstError) return buildFallbackHealth(firstError.message, now)

    const configByKey = new Map<string, SystemConfigRow>(
      ((configRows ?? []) as SystemConfigRow[]).map((row) => [row.key, row]),
    )
    const configValue = (key: string) => text(configByKey.get(key)?.value)
    const configUpdatedAt = (key: string) => isoOrNull(configByKey.get(key)?.updated_at)

    const sessionStatus = configValue('mojo_session_status') || 'unknown'
    const syncHealth = configValue('mojo_sync_health') || 'unknown'
    const lastSyncAt = isoOrNull(configValue('mojo_sync_last_ok_at'))
      || configUpdatedAt('mojo_sync_last_ok_at')
      || isoOrNull(configValue('last_mojo_sync_timestamp'))
      || configUpdatedAt('last_mojo_sync_timestamp')
    const lastSessionOkAt = isoOrNull(configValue('mojo_session_last_ok_at')) || configUpdatedAt('mojo_session_last_ok_at')
    const sessionError = configValue('mojo_session_last_error') || null
    const sessionErrorAt = isoOrNull(configValue('mojo_session_last_error_at')) || configUpdatedAt('mojo_session_last_error_at')
    const syncError = configValue('mojo_sync_last_error') || null
    const syncErrorAt = isoOrNull(configValue('mojo_sync_last_error_at')) || configUpdatedAt('mojo_sync_last_error_at')
    const lastError = sessionStatus.toLowerCase() === 'expired'
      ? sessionError
      : syncHealth.toLowerCase() === 'down' ? syncError : sessionError || syncError
    const lastErrorAt = sessionStatus.toLowerCase() === 'expired'
      ? sessionErrorAt
      : syncHealth.toLowerCase() === 'down' ? syncErrorAt : sessionErrorAt || syncErrorAt

    const queue = (queueRows ?? []) as MojoQueueRow[]
    const leads = (periodLeadRows ?? []) as MojoLeadRow[]
    const recentLeads = (recentLeadRows ?? []) as MojoLeadRow[]
    const callEvents = (callEventRows ?? []) as MojoCallEventRow[]
    const callEvents24h = callEvents.filter((event) => {
      const callAt = isoOrNull(event.call_at)
      return Boolean(callAt && callAt >= since24h)
    })
    const qualification = {
      eligible24h: callEvents24h.filter((event) => event.promotion_eligible === true).length,
      ineligible24h: callEvents24h.filter((event) => text(event.qualification_status) === 'ineligible').length,
      evidencePending24h: callEvents24h.filter((event) => text(event.qualification_status) === 'evidence_pending').length
        + queue.filter((row) => {
          const created = isoOrNull(row.created_at)
          return Boolean(created && created >= since24h && text(row.status).toLowerCase() === 'waiting_evidence')
        }).length,
      recordingOutstanding24h: callEvents24h.filter((event) => (
        event.promotion_eligible === true
        && !['analyzed', 'failed'].includes(text(event.recording_processing_status))
      )).length,
      recordingFailed7d: callEvents.filter((event) => text(event.recording_processing_status) === 'failed').length,
      analyzed24h: callEvents24h.filter((event) => text(event.recording_processing_status) === 'analyzed').length,
    }
    const queued24hRows = queue.filter((row) => {
      const created = isoOrNull(row.created_at)
      return created ? created >= since24h : false
    })
    const completed24hRows = queue.filter((row) => {
      const completed = isoOrNull(row.completed_at)
      return completed ? completed >= since24h : false
    })
    const failed24hRows = queue.filter((row) => {
      const created = isoOrNull(row.created_at)
      return created ? created >= since24h && text(row.status).toLowerCase() === 'failed' : false
    })
    const deadLetterRows = queue.filter((row) => text(row.status).toLowerCase() === 'dead_letter')
    const latestQueueError = queue.map((row) => text(row.last_error)).find(Boolean) || null
    const latestQueuedAt = latestIso(queue.map((row) => row.created_at))
    const latestCompletedAt = latestIso(queue.map((row) => row.completed_at))
    const lastSyncAgeMinutes = ageMinutes(lastSyncAt, now)
    const businessHours = centralBusinessHours(now)
    const pending = countByStatus(queue, 'pending')
    const processing = countByStatus(queue, 'processing')
    const qualifiedPeriod = leads.filter((lead) => QUALIFIED_STATIONS.has(text(lead.station).toLowerCase())).length
    const appointmentPeriod = leads.filter((lead) => text(lead.station).toLowerCase() === 'appointment_set').length
    const latestPerformance = ((performanceRows ?? []) as MojoPerformanceRow[])[0]
    const latestMetricDate = text(latestPerformance?.metric_date) || null
    const latestFetchedAt = isoOrNull(latestPerformance?.source_fetched_at)
    const performanceAgeMinutes = ageMinutes(latestFetchedAt, now)
    const today = centralDateKey(now)
    const performanceSyncHealth = configValue('mojo_performance_sync_health') || 'unknown'
    const performanceSyncLastOkAt = isoOrNull(configValue('mojo_performance_sync_last_ok_at'))
      || configUpdatedAt('mojo_performance_sync_last_ok_at')
    const performanceSyncLastError = configValue('mojo_performance_sync_last_error') || null
    const performanceSyncLastErrorAt = isoOrNull(configValue('mojo_performance_sync_last_error_at'))
      || configUpdatedAt('mojo_performance_sync_last_error_at')
    const centralHour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hour: 'numeric', hour12: false,
    }).formatToParts(now).find((part) => part.type === 'hour')?.value ?? 0)
    const centralMinute = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', minute: '2-digit',
    }).formatToParts(now).find((part) => part.type === 'minute')?.value ?? 0)
    const withinStartupGrace = businessHours && centralHour === 8 && centralMinute < 30

    let performanceStatus: MojoHealth['performance']['status'] = 'current'
    let performanceMessage = 'Mojo provider performance is current'
    if (businessHours && performanceSyncHealth.toLowerCase() === 'down') {
      performanceStatus = 'unavailable'
      performanceMessage = performanceSyncLastError || 'Mojo provider performance sync is down'
    } else if (businessHours && latestMetricDate !== today) {
      performanceStatus = withinStartupGrace ? 'delayed' : latestFetchedAt ? 'stale' : 'unavailable'
      performanceMessage = latestFetchedAt
        ? `Mojo provider performance was last updated ${centralTimestamp(latestFetchedAt)}`
        : 'Mojo has no current provider performance snapshot'
    } else if (businessHours && !latestFetchedAt) {
      performanceStatus = 'unavailable'
      performanceMessage = `Mojo provider performance for ${today} has no fetch timestamp`
    } else if (businessHours && (performanceAgeMinutes ?? 0) >= 120) {
      performanceStatus = 'stale'
      performanceMessage = `Mojo provider performance has not updated in ${performanceAgeMinutes} minutes during business hours`
    } else if (businessHours && (performanceAgeMinutes ?? 0) >= 60) {
      performanceStatus = 'delayed'
      performanceMessage = `Mojo provider performance is delayed by ${performanceAgeMinutes} minutes`
    }

    let status: MojoHealthStatus = 'clean'
    let message = 'Mojo sync is healthy'
    if (['expired', 'missing'].includes(sessionStatus.toLowerCase())) {
      status = 'attention'
      message = lastError || 'Mojo session expired - manual refresh required'
    } else if (performanceSyncHealth.toLowerCase() === 'down') {
      status = 'attention'
      message = performanceSyncLastError || 'Mojo provider performance sync is down'
    } else if (syncHealth.toLowerCase() === 'down') {
      status = 'attention'
      message = lastError || 'Mojo sync freshness is outside the supervised limit'
    } else if (deadLetterRows.length > 0 || failed24hRows.length > 0 || qualification.recordingFailed7d > 0) {
      status = 'attention'
      const failureCount = deadLetterRows.length + failed24hRows.length + qualification.recordingFailed7d
      message = `Mojo ingestion has ${failureCount} failed item${failureCount === 1 ? '' : 's'}`
    } else if (businessHours && !lastSyncAt) {
      status = 'attention'
      message = 'Mojo sync has no successful timestamp during business hours'
    } else if (businessHours && latestMetricDate !== today) {
      status = withinStartupGrace ? 'watch' : 'attention'
      message = performanceMessage
    } else if (businessHours && !latestFetchedAt) {
      status = 'attention'
      message = `Mojo provider performance for ${today} has no fetch timestamp`
    } else if (businessHours && (performanceAgeMinutes ?? 0) >= 120) {
      status = 'attention'
      message = `Mojo provider performance has not updated in ${performanceAgeMinutes} minutes during business hours`
    } else if (businessHours && (lastSyncAgeMinutes ?? 0) >= 120) {
      status = 'attention'
      message = `Mojo sync has not completed in ${lastSyncAgeMinutes} minutes during business hours`
    } else if (businessHours && (performanceAgeMinutes ?? 0) >= 60) {
      status = 'watch'
      message = `Mojo provider performance is delayed by ${performanceAgeMinutes} minutes`
    } else if (businessHours && (lastSyncAgeMinutes ?? 0) >= 60) {
      status = 'watch'
      message = `Mojo sync is stale by ${lastSyncAgeMinutes} minutes`
    } else if (pending > 0 || processing > 0 || qualification.recordingOutstanding24h > 0 || qualification.evidencePending24h > 0) {
      status = 'watch'
      const activeCount = pending + processing + qualification.recordingOutstanding24h + qualification.evidencePending24h
      message = `Mojo ingestion has ${activeCount} active item${activeCount === 1 ? '' : 's'}`
    }

    return {
      status,
      message,
      sessionStatus,
      syncHealth,
      businessHours,
      lastSyncAt,
      lastSyncAgeMinutes,
      lastSessionOkAt,
      lastError,
      lastErrorAt,
      latestQueuedAt,
      latestCompletedAt,
      latestQueueError,
      performance: {
        status: performanceStatus,
        message: performanceMessage,
        latestMetricDate,
        latestFetchedAt,
        ageMinutes: performanceAgeMinutes,
        syncHealth: performanceSyncHealth,
        lastOkAt: performanceSyncLastOkAt,
        lastError: performanceSyncLastError,
        lastErrorAt: performanceSyncLastErrorAt,
      },
      queue: {
        pending,
        processing,
        completed24h: completed24hRows.length,
        failed24h: failed24hRows.length,
        deadLetter: deadLetterRows.length,
        queued24h: queued24hRows.length,
        total7d: queue.length,
      },
      qualification,
      leads: {
        last24h: recentLeads.length,
        period: leads.length,
        qualifiedPeriod,
        appointmentPeriod,
      },
      monitor: {
        path: '/api/admin/mojo-health',
        schedule: 'Every 15 minutes during Mojo business hours',
        manualRefreshCommand: 'npm run mojo:session:manual',
      },
    }
  } catch (error) {
    return buildFallbackHealth(error instanceof Error ? error.message : String(error), now)
  }
}

export async function persistMojoHealth(supabase: SupabaseLike, health: MojoHealth): Promise<void> {
  const now = new Date().toISOString()
  const workerPayload: Record<string, unknown> = {
    name: 'Mojo Health',
    type: 'cron',
    description: 'Checks Mojo session cookie, call queue, and CRM lead intake health.',
    check_interval_minutes: 15,
    last_run: now,
    status: systemWorkerStatus(health.status),
    last_error: health.status === 'clean' ? null : health.message,
    metadata: health,
  }
  if (health.status !== 'attention') {
    workerPayload.last_success = now
  }

  const configPayloads = [
    {
      key: 'mojo_health_snapshot',
      value: JSON.stringify(health),
      updated_at: now,
    },
    {
      key: 'mojo_health_status',
      value: health.status,
      updated_at: now,
    },
    {
      key: 'mojo_health_message',
      value: health.message,
      updated_at: now,
    },
  ]

  await Promise.all([
    supabase
      .from('system_workers')
      .upsert(
        workerPayload,
        { onConflict: 'name' },
      ),
    supabase
      .from('system_config')
      .upsert(configPayloads, { onConflict: 'key' }),
  ])
}
