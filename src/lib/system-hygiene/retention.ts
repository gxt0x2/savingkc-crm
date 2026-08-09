import { supabaseAdmin } from '@/lib/supabase/admin'

export interface RetentionRunResult {
  available: boolean
  applied: boolean
  blocked: boolean
  runId: string | null
  rows: Array<Record<string, unknown>>
  error: string | null
}

const MUTATIONS_ENABLED = process.env.DATA_RETENTION_MUTATIONS_ENABLED === 'true'

export async function runDataRetention(options: {
  apply?: boolean
  invokedBy: string
}): Promise<RetentionRunResult> {
  const requestedApply = options.apply === true
  const blocked = requestedApply && !MUTATIONS_ENABLED
  const mode = requestedApply ? 'apply' : 'dry_run'
  const db = supabaseAdmin()
  const { data: run, error: runError } = await db
    .from('data_retention_runs')
    .insert({
      mode,
      status: blocked ? 'blocked' : 'running',
      invoked_by: options.invokedBy,
      error: blocked ? 'DATA_RETENTION_MUTATIONS_ENABLED is not true.' : null,
    })
    .select('id')
    .single()

  if (runError) {
    return {
      available: false,
      applied: false,
      blocked,
      runId: null,
      rows: [],
      error: 'Retention schema is not available in this environment.',
    }
  }

  if (blocked) {
    await db
      .from('data_retention_runs')
      .update({ finished_at: new Date().toISOString() })
      .eq('id', run.id)
    return {
      available: true,
      applied: false,
      blocked: true,
      runId: run.id,
      rows: [],
      error: 'Apply mode is blocked by the deployment safety switch.',
    }
  }

  const rpcName = requestedApply ? 'apply_data_retention' : 'preview_data_retention'
  const { data, error } = await db.rpc(rpcName)
  const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : []

  await db
    .from('data_retention_runs')
    .update({
      status: error ? 'failed' : 'success',
      summary: rows,
      error: error?.message ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', run.id)

  if (!error) {
    await db
      .from('system_workers')
      .update({
        last_run: new Date().toISOString(),
        last_success: new Date().toISOString(),
        last_error: null,
        failure_count_24h: 0,
        status: 'healthy',
      })
      .eq('name', 'Data Retention Monitor')
  }

  return {
    available: true,
    applied: requestedApply && !error,
    blocked: false,
    runId: run.id,
    rows,
    error: error?.message ?? null,
  }
}
