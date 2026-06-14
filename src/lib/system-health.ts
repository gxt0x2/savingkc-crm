// ROL-04: System Worker Registry & Health Monitoring
// Night 4 Phase 4: Monitor automated workers as employees

import type { SupabaseClient } from '@supabase/supabase-js'

type WorkerStatus = 'healthy' | 'degraded' | 'down' | 'unknown'
type WorkerType = 'poller' | 'cron' | 'webhook' | 'enrichment' | 'sync'

export interface SystemWorker {
  id: string
  name: string
  type: WorkerType
  description: string | null
  check_interval_minutes: number | null
  last_run: string | null
  last_success: string | null
  last_error: string | null
  failure_count_24h: number
  status: WorkerStatus
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
}

export interface WorkerHealthSummary {
  total: number
  healthy: number
  degraded: number
  down: number
  unknown: number
  critical_workers_down: string[] // Names of critical workers that are down
}

/**
 * Get all system workers with their current health status
 */
export async function getAllWorkers(
  supabase: SupabaseClient<any>
): Promise<SystemWorker[]> {
  const { data, error } = await supabase
    .from('system_workers')
    .select('*')
    .order('status', { ascending: false }) // Down first, then degraded, etc.
    .order('name', { ascending: true })

  if (error) {
    console.error('Failed to fetch system workers:', error)
    return []
  }

  return (data as SystemWorker[]) || []
}

/**
 * Get summary of worker health
 */
export async function getWorkerHealthSummary(
  supabase: SupabaseClient<any>
): Promise<WorkerHealthSummary> {
  const workers = await getAllWorkers(supabase)

  const summary: WorkerHealthSummary = {
    total: workers.length,
    healthy: workers.filter(w => w.status === 'healthy').length,
    degraded: workers.filter(w => w.status === 'degraded').length,
    down: workers.filter(w => w.status === 'down').length,
    unknown: workers.filter(w => w.status === 'unknown').length,
    critical_workers_down: [],
  }

  // Critical workers (must always be healthy)
  const criticalWorkers = [
    'Twilio Webhook (Inbound SMS)',
    'Twilio Webhook (Missed Call)',
    'Mojo Sync',
    'Mojo Health',
    'Follow-Up Sequence Runner',
  ]

  summary.critical_workers_down = workers
    .filter(w => criticalWorkers.includes(w.name) && w.status === 'down')
    .map(w => w.name)

  return summary
}

/**
 * Record a worker run (success or failure)
 */
export async function recordWorkerRun(
  supabase: SupabaseClient<any>,
  workerName: string,
  success: boolean,
  error?: string
): Promise<void> {
  const now = new Date().toISOString()

  const updateData: any = {
    last_run: now,
    updated_at: now,
  }

  if (success) {
    updateData.last_success = now
    updateData.last_error = null
    // Reset failure count on success (will be recalculated by status checker)
  } else {
    updateData.last_error = error || 'Unknown error'
    // Increment failure count (24h window is handled by periodic cleanup)
    const { data: worker } = await supabase
      .from('system_workers')
      .select('failure_count_24h')
      .eq('name', workerName)
      .single()

    if (worker) {
      updateData.failure_count_24h = (worker.failure_count_24h || 0) + 1
    }
  }

  await supabase
    .from('system_workers')
    .update(updateData)
    .eq('name', workerName)
}

/**
 * Reset 24-hour failure counts (should be called daily)
 */
export async function resetFailureCounts(
  supabase: SupabaseClient<any>
): Promise<number> {
  const { data, error } = await supabase
    .from('system_workers')
    .update({ failure_count_24h: 0, updated_at: new Date().toISOString() })
    .neq('failure_count_24h', 0)
    .select('id')

  if (error) {
    console.error('Failed to reset failure counts:', error)
    return 0
  }

  return data?.length || 0
}

/**
 * Generate Ari briefing event for worker health issues
 */
export async function alertOnWorkerIssues(
  supabase: SupabaseClient<any>
): Promise<number> {
  const workers = await getAllWorkers(supabase)
  const problematicWorkers = workers.filter(
    w => w.status === 'down' || w.status === 'degraded'
  )

  let alertsCreated = 0

  for (const worker of problematicWorkers) {
    const priority = worker.status === 'down' ? 'high' : 'medium'

    const description =
      worker.status === 'down'
        ? `Worker has not succeeded in > 2x expected interval (${worker.check_interval_minutes} min). Last success: ${worker.last_success || 'never'}.`
        : `Worker has ${worker.failure_count_24h} failures in the last 24 hours. Degraded performance.`

    const { error } = await supabase.from('ari_briefing_events').insert({
      event_type: 'system_health',
      priority,
      title: `⚙️ System Worker ${worker.status.toUpperCase()}: ${worker.name}`,
      description,
      metadata: {
        worker_id: worker.id,
        worker_name: worker.name,
        worker_type: worker.type,
        status: worker.status,
        last_success: worker.last_success,
        last_error: worker.last_error,
        failure_count: worker.failure_count_24h,
      },
      dismissed: false,
    })

    if (!error) alertsCreated++
  }

  return alertsCreated
}

/**
 * Get role by name
 */
export async function getRole(
  supabase: SupabaseClient<any>,
  roleName: string
): Promise<{
  id: string
  name: string
  description: string | null
  kpi_targets: Record<string, any> | null
} | null> {
  const { data } = await supabase
    .from('roles')
    .select('*')
    .eq('name', roleName)
    .single()

  return data || null
}

/**
 * Get user's role and KPI targets
 */
export async function getUserRole(
  supabase: SupabaseClient<any>,
  userId: string
): Promise<{
  role_name: string
  kpi_targets: Record<string, any> | null
} | null> {
  const { data: user } = await supabase
    .from('users')
    .select('role_id')
    .eq('id', userId)
    .single()

  if (!user?.role_id) return null

  const { data: role } = await supabase
    .from('roles')
    .select('name, kpi_targets')
    .eq('id', user.role_id)
    .single()

  if (!role) return null

  return {
    role_name: role.name,
    kpi_targets: role.kpi_targets,
  }
}
