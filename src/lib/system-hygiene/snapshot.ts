import { supabaseAdmin } from '@/lib/supabase/admin'
import { getRegisteredCrons, systemRegistry } from '@/lib/system-hygiene/registry'

export interface RetentionPolicySnapshot {
  id: string
  table_name: string
  retention_days: number
  batch_size: number
  monitoring_enabled: boolean
  deletion_enabled: boolean
  archive_required: boolean
  archive_reference: string | null
  archive_verified_at: string | null
  owner: string
  last_preview_at: string | null
  last_apply_at: string | null
}

export interface RetentionRunSnapshot {
  id: string
  mode: 'dry_run' | 'apply'
  status: 'running' | 'success' | 'failed' | 'blocked'
  invoked_by: string
  started_at: string
  finished_at: string | null
  summary: Array<Record<string, unknown>>
  error: string | null
}

export interface WorkerSnapshot {
  name: string
  type: string
  status: 'healthy' | 'degraded' | 'down' | 'unknown'
  check_interval_minutes: number
  last_run: string | null
  last_success: string | null
  last_error: string | null
  failure_count_24h: number
}

export interface SystemHygieneSnapshot {
  generatedAt: string
  registry: {
    schemaVersion: number
    activeFeatures: number
    experimentalFeatures: number
    deprecatedFeatures: number
    registeredTables: number
    registeredEnvironmentVariables: number
    registeredCrons: ReturnType<typeof getRegisteredCrons>
  }
  retention: {
    available: boolean
    mutationsEnabled: boolean
    policies: RetentionPolicySnapshot[]
    recentRuns: RetentionRunSnapshot[]
    error: string | null
  }
  workers: {
    available: boolean
    rows: WorkerSnapshot[]
    error: string | null
  }
}

export async function getSystemHygieneSnapshot(): Promise<SystemHygieneSnapshot> {
  const features = systemRegistry.features
  const registeredTables = new Set(features.flatMap((feature) => feature.tables))
  const registeredEnvironment = new Set(features.flatMap((feature) => feature.environment))
  const snapshot: SystemHygieneSnapshot = {
    generatedAt: new Date().toISOString(),
    registry: {
      schemaVersion: systemRegistry.schemaVersion,
      activeFeatures: features.filter((feature) => feature.status === 'active').length,
      experimentalFeatures: features.filter((feature) => feature.status === 'experimental').length,
      deprecatedFeatures: features.filter((feature) => feature.status === 'deprecated').length,
      registeredTables: registeredTables.size,
      registeredEnvironmentVariables: registeredEnvironment.size,
      registeredCrons: getRegisteredCrons(),
    },
    retention: {
      available: false,
      mutationsEnabled: process.env.DATA_RETENTION_MUTATIONS_ENABLED === 'true',
      policies: [],
      recentRuns: [],
      error: null,
    },
    workers: {
      available: false,
      rows: [],
      error: null,
    },
  }

  try {
    const db = supabaseAdmin()
    const [policiesResult, runsResult, workersResult] = await Promise.all([
      db
        .from('data_retention_policies')
        .select('id,table_name,retention_days,batch_size,monitoring_enabled,deletion_enabled,archive_required,archive_reference,archive_verified_at,owner,last_preview_at,last_apply_at')
        .order('table_name'),
      db
        .from('data_retention_runs')
        .select('id,mode,status,invoked_by,started_at,finished_at,summary,error')
        .order('started_at', { ascending: false })
        .limit(10),
      db
        .from('system_workers')
        .select('name,type,status,check_interval_minutes,last_run,last_success,last_error,failure_count_24h')
        .order('name'),
    ])

    if (!policiesResult.error && !runsResult.error) {
      snapshot.retention.available = true
      snapshot.retention.policies = (policiesResult.data ?? []) as RetentionPolicySnapshot[]
      snapshot.retention.recentRuns = (runsResult.data ?? []) as RetentionRunSnapshot[]
    } else {
      snapshot.retention.error = 'Retention migration has not been applied to this environment.'
    }

    if (!workersResult.error) {
      snapshot.workers.available = true
      snapshot.workers.rows = (workersResult.data ?? []) as WorkerSnapshot[]
    } else {
      snapshot.workers.error = 'Worker telemetry is unavailable.'
    }
  } catch {
    snapshot.retention.error = 'Database health could not be read.'
    snapshot.workers.error = 'Database health could not be read.'
  }

  return snapshot
}
