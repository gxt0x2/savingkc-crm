import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { WORKFLOW_CATALOG, validateWorkflowDefinition } from '@/lib/operating-model/workflow-catalog'
import { readStoredWorkflowDefinitions } from '@/lib/operating-model/workflow-store'
import type { WorkflowDefinition } from '@/lib/operating-model/types'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { WorkItemError } from '@/lib/server/work-items'
import {
  executeSellerIntakeWorkflow,
  SellerIntakeWorkflowError,
} from '@/lib/server/seller-intake-workflow-action'
import {
  APPROVED_FOLLOW_UP_WORKFLOW_ID,
  executeApprovedFollowUpTask,
  prepareApprovedFollowUpInput,
  WorkflowInputError,
} from '@/lib/server/workflow-task-action'

export const SUPPORTED_WORKFLOW_EXECUTORS = [
  'workflow-registry-health',
  APPROVED_FOLLOW_UP_WORKFLOW_ID,
] as const

export const WORKER_EXECUTABLE_WORKFLOW_IDS = [
  ...SUPPORTED_WORKFLOW_EXECUTORS,
  'seller-form-intake',
] as const

type WorkflowRunStatus =
  | 'awaiting_approval'
  | 'queued'
  | 'running'
  | 'retry_scheduled'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'cancelled'

export type WorkflowRun = {
  id: string
  workflow_id: string
  workflow_version: number
  definition_hash: string
  status: WorkflowRunStatus
  approval_policy: WorkflowDefinition['implementation']['approvalPolicy']
  mutates_data: boolean
  trigger_kind: string
  trigger_key: string | null
  idempotency_key: string
  requested_by: string
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  attempt_count: number
  max_attempts: number
  available_at: string
  lease_owner: string | null
  lease_expires_at: string | null
  error_code: string | null
  error_message: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

type Db = SupabaseClient

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function workflowHash(definition: WorkflowDefinition): string {
  return createHash('sha256').update(JSON.stringify(definition)).digest('hex')
}

function rpcRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null
  return data ? data as T : null
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown workflow error')
}

function safeError(error: unknown): { code: string; message: string; retryable: boolean } {
  const raw = message(error)
  if (error instanceof WorkflowInputError) {
    return { code: error.code, message: raw.slice(0, 800), retryable: false }
  }
  if (error instanceof SellerIntakeWorkflowError) {
    return { code: error.code, message: raw.slice(0, 800), retryable: false }
  }
  if (error instanceof WorkItemError) {
    return {
      code: `work_item_${error.code}`,
      message: raw.slice(0, 800),
      retryable: error.code === 'unavailable',
    }
  }
  if (raw.includes('executor_unavailable')) {
    return { code: 'executor_unavailable', message: raw.slice(0, 800), retryable: false }
  }
  if (raw.includes('workflow_registry_invalid')) {
    return { code: 'workflow_registry_invalid', message: raw.slice(0, 800), retryable: false }
  }
  return { code: 'workflow_execution_failed', message: raw.slice(0, 800), retryable: true }
}

export function findActiveWorkflowDefinition(workflowId: string): WorkflowDefinition | null {
  return WORKFLOW_CATALOG.find((workflow) => workflow.id === workflowId && workflow.status === 'active') ?? null
}

export function supportsWorkflowExecution(workflowId: string): boolean {
  return (SUPPORTED_WORKFLOW_EXECUTORS as readonly string[]).includes(workflowId)
}

export function prepareWorkflowRunInput(
  workflowId: string,
  value: unknown,
  actorName: string,
): Record<string, unknown> {
  if (workflowId === 'workflow-registry-health') return object(value)
  if (workflowId === APPROVED_FOLLOW_UP_WORKFLOW_ID) {
    return prepareApprovedFollowUpInput(value, actorName)
  }
  throw new WorkflowInputError('This workflow does not have an approved input contract.')
}

export async function startWorkflowRun(input: {
  definition: WorkflowDefinition
  actor: string
  idempotencyKey: string
  verifiedServerEvent?: 'seller_intake'
  triggerKind?: string
  triggerKey?: string | null
  payload?: Record<string, unknown>
  maxAttempts?: number
}, db: Db = supabaseAdmin()): Promise<WorkflowRun> {
  const definitionHash = workflowHash(input.definition)
  const starterRpc = input.verifiedServerEvent === 'seller_intake'
    ? 'workflow_start_verified_seller_intake_v1'
    : 'workflow_start_run_v1'
  const { data, error } = await db.rpc(starterRpc, {
    p_workflow_id: input.definition.id,
    p_workflow_version: input.definition.version,
    p_definition_hash: definitionHash,
    p_definition_snapshot: input.definition,
    p_workflow_status: input.definition.status,
    p_approval_policy: input.definition.implementation.approvalPolicy,
    p_mutates_data: input.definition.implementation.mutatesData,
    p_trigger_kind: input.triggerKind ?? 'manual',
    p_trigger_key: input.triggerKey ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_requested_by: input.actor,
    p_input: input.payload ?? {},
    p_max_attempts: input.maxAttempts ?? 3,
  })
  if (error) throw new Error(`Workflow run could not start: ${error.message}`)
  const run = rpcRow<WorkflowRun>(data)
  if (!run) throw new Error('Workflow run could not start: empty database response')
  return run
}

export async function listWorkflowRuns(limit = 25, db: Db = supabaseAdmin()): Promise<WorkflowRun[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100))
  const { data, error } = await db
    .from('workflow_runs')
    .select('id, workflow_id, workflow_version, definition_hash, status, approval_policy, mutates_data, trigger_kind, trigger_key, idempotency_key, requested_by, input, output, attempt_count, max_attempts, available_at, lease_owner, lease_expires_at, error_code, error_message, started_at, finished_at, created_at, updated_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(safeLimit)
  if (error) throw new Error(`Workflow runs unavailable: ${error.message}`)
  return (data ?? []) as WorkflowRun[]
}

export async function decideWorkflowRun(input: {
  runId: string
  decision: 'approved' | 'rejected'
  idempotencyKey: string
  actor: string
  note?: string | null
}, db: Db = supabaseAdmin()): Promise<WorkflowRun> {
  const { data, error } = await db.rpc('workflow_decide_run_v1', {
    p_run_id: input.runId,
    p_decision: input.decision,
    p_idempotency_key: input.idempotencyKey,
    p_decided_by: input.actor,
    p_note: input.note ?? null,
  })
  if (error) throw new Error(`Workflow decision failed: ${error.message}`)
  const run = rpcRow<WorkflowRun>(data)
  if (!run) throw new Error('Workflow decision failed: empty database response')
  return run
}

async function claimWorkflowRun(runId: string, workerId: string, db: Db): Promise<WorkflowRun | null> {
  const { data, error } = await db.rpc('workflow_claim_specific_run_v1', {
    p_run_id: runId,
    p_worker_id: workerId,
    p_lease_seconds: 120,
  })
  if (error) throw new Error(`Workflow claim failed: ${error.message}`)
  return rpcRow<WorkflowRun>(data)
}

async function nextSupportedRunId(db: Db): Promise<string | null> {
  const now = new Date().toISOString()
  const [ready, stale] = await Promise.all([
    db.from('workflow_runs').select('id, available_at')
      .in('workflow_id', [...WORKER_EXECUTABLE_WORKFLOW_IDS])
      .in('status', ['queued', 'retry_scheduled'])
      .lte('available_at', now)
      .order('available_at', { ascending: true }).order('created_at', { ascending: true })
      .limit(1).maybeSingle(),
    db.from('workflow_runs').select('id, lease_expires_at')
      .in('workflow_id', [...WORKER_EXECUTABLE_WORKFLOW_IDS])
      .eq('status', 'running').lte('lease_expires_at', now)
      .order('lease_expires_at', { ascending: true }).order('created_at', { ascending: true })
      .limit(1).maybeSingle(),
  ])
  if (ready.error) throw new Error(`Workflow queue unavailable: ${ready.error.message}`)
  if (stale.error) throw new Error(`Workflow stale lease queue unavailable: ${stale.error.message}`)
  const candidates = [
    ready.data && typeof ready.data.id === 'string' ? { id: ready.data.id, at: String(ready.data.available_at || '') } : null,
    stale.data && typeof stale.data.id === 'string' ? { id: stale.data.id, at: String(stale.data.lease_expires_at || '') } : null,
  ].filter((value): value is { id: string; at: string } => Boolean(value))
  candidates.sort((left, right) => left.at.localeCompare(right.at))
  return candidates[0]?.id ?? null
}

async function recordStep(input: {
  run: WorkflowRun
  workerId: string
  stepKey: string
  status: 'succeeded' | 'failed' | 'skipped'
  startedAt: string
  output?: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
}, db: Db): Promise<void> {
  const { error } = await db.rpc('workflow_record_step_v1', {
    p_run_id: input.run.id,
    p_worker_id: input.workerId,
    p_step_index: 0,
    p_step_key: input.stepKey,
    p_status: input.status,
    p_idempotency_key: `${input.run.id}:${input.stepKey}:${input.run.attempt_count}`,
    p_started_at: input.startedAt,
    p_input: input.run.input,
    p_output: input.output ?? null,
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage ?? null,
  })
  if (error) throw new Error(`Workflow step could not be recorded: ${error.message}`)
}

async function finishRun(input: {
  runId: string
  workerId: string
  outcome: 'succeeded' | 'failed'
  output?: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
  retryable?: boolean
}, db: Db): Promise<WorkflowRun> {
  const { data, error } = await db.rpc('workflow_finish_run_v2', {
    p_run_id: input.runId,
    p_worker_id: input.workerId,
    p_outcome: input.outcome,
    p_output: input.output ?? null,
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage ?? null,
    p_retryable: input.retryable !== false,
  })
  if (error) throw new Error(`Workflow run could not finish: ${error.message}`)
  const run = rpcRow<WorkflowRun>(data)
  if (!run) throw new Error('Workflow run could not finish: empty database response')
  return run
}

async function registryHealth(db: Db): Promise<Record<string, unknown>> {
  const stored = await readStoredWorkflowDefinitions(db)
  const definitions = [...WORKFLOW_CATALOG, ...stored.map((entry) => entry.definition)]
  const duplicateIds = [...new Set(definitions
    .map((definition) => definition.id)
    .filter((id, index, values) => values.indexOf(id) !== index))]
  const issues = definitions.flatMap((definition) =>
    validateWorkflowDefinition(definition).map((issue) => ({ workflowId: definition.id, ...issue })))
  const errors = issues.filter((issue) => issue.severity === 'error')
  if (duplicateIds.length > 0 || errors.length > 0) {
    throw new Error(`workflow_registry_invalid:${duplicateIds.length} duplicate ids, ${errors.length} validation errors`)
  }
  return {
    healthy: true,
    checkedAt: new Date().toISOString(),
    definitions: definitions.length,
    codeOwned: WORKFLOW_CATALOG.length,
    storedDrafts: stored.length,
    active: definitions.filter((definition) => definition.status === 'active').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
    duplicateIds: 0,
    validationErrors: 0,
  }
}

type WorkflowExecutionResult = { stepKey: string; output: Record<string, unknown> }

function stepKeyForWorkflow(workflowId: string): string {
  if (workflowId === APPROVED_FOLLOW_UP_WORKFLOW_ID) return 'create_follow_up_task'
  if (workflowId === 'seller-form-intake') return 'establish_seller_intake'
  return 'validate_registry'
}

async function executeDefinition(run: WorkflowRun, db: Db): Promise<WorkflowExecutionResult> {
  if (run.workflow_id === 'workflow-registry-health') {
    return { stepKey: 'validate_registry', output: await registryHealth(db) }
  }
  if (run.workflow_id === APPROVED_FOLLOW_UP_WORKFLOW_ID) {
    const result = await executeApprovedFollowUpTask({
      runId: run.id,
      workflowVersion: run.workflow_version,
      definitionHash: run.definition_hash,
      triggerKind: run.trigger_kind,
      requestedBy: run.requested_by,
      payload: run.input,
    }, db)
    return {
      stepKey: 'create_follow_up_task',
      output: {
        created: result.created,
        workItemKey: result.workItem.key,
        leadId: result.workItem.leadId,
        title: result.workItem.title,
        assignedTo: result.workItem.assignedTo,
        dueAt: result.workItem.dueAt,
      },
    }
  }
  if (run.workflow_id === 'seller-form-intake') {
    return {
      stepKey: 'establish_seller_intake',
      output: await executeSellerIntakeWorkflow({
        runId: run.id,
        workflowVersion: run.workflow_version,
        definitionHash: run.definition_hash,
        triggerKind: run.trigger_kind,
        requestedBy: run.requested_by,
        payload: run.input,
      }, db),
    }
  }
  throw new Error(`executor_unavailable:${run.workflow_id}`)
}

export async function executeWorkflowRun(runId: string, workerId = `workflow-worker:${randomUUID()}`, db: Db = supabaseAdmin()): Promise<WorkflowRun | null> {
  const run = await claimWorkflowRun(runId, workerId, db)
  if (!run) return null
  const startedAt = new Date().toISOString()
  const stepKey = stepKeyForWorkflow(run.workflow_id)
  try {
    const execution = await executeDefinition(run, db)
    await recordStep({ run, workerId, stepKey: execution.stepKey, status: 'succeeded', startedAt, output: execution.output }, db)
    return finishRun({ runId: run.id, workerId, outcome: 'succeeded', output: execution.output }, db)
  } catch (cause) {
    const failure = safeError(cause)
    try {
      await recordStep({ run, workerId, stepKey, status: 'failed', startedAt, errorCode: failure.code, errorMessage: failure.message }, db)
    } catch (stepError) {
      console.error('[workflow-runs] failed step audit', { runId: run.id, error: message(stepError) })
    }
    return finishRun({
      runId: run.id,
      workerId,
      outcome: 'failed',
      errorCode: failure.code,
      errorMessage: failure.message,
      retryable: failure.retryable,
    }, db)
  }
}

export async function executeNextWorkflowRun(workerId = `workflow-worker:${randomUUID()}`, db: Db = supabaseAdmin()): Promise<WorkflowRun | null> {
  for (let claimAttempt = 0; claimAttempt < 3; claimAttempt += 1) {
    const runId = await nextSupportedRunId(db)
    if (!runId) return null
    const run = await executeWorkflowRun(runId, workerId, db)
    if (run) return run
  }
  return null
}

export function workflowRunPayload(value: unknown): Record<string, unknown> {
  return object(value)
}
