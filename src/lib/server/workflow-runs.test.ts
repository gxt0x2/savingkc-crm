import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  executeWorkflowRun,
  findActiveWorkflowDefinition,
  startWorkflowRun,
  supportsWorkflowExecution,
  type WorkflowRun,
} from './workflow-runs'

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    workflow_id: 'workflow-registry-health',
    workflow_version: 1,
    definition_hash: 'a'.repeat(64),
    status: 'running',
    approval_policy: 'automatic',
    mutates_data: false,
    trigger_kind: 'manual',
    trigger_key: null,
    idempotency_key: 'registry-health:test',
    requested_by: 'Tester',
    input: {},
    output: null,
    attempt_count: 1,
    max_attempts: 3,
    available_at: '2026-08-20T00:00:00.000Z',
    lease_owner: 'worker:test',
    lease_expires_at: '2026-08-20T00:02:00.000Z',
    error_code: null,
    error_message: null,
    started_at: '2026-08-20T00:00:00.000Z',
    finished_at: null,
    created_at: '2026-08-20T00:00:00.000Z',
    updated_at: '2026-08-20T00:00:00.000Z',
    ...overrides,
  }
}

describe('workflow run service', () => {
  it('exposes the read-only health executor and the approved task executor only', () => {
    expect(findActiveWorkflowDefinition('workflow-registry-health')?.implementation.mutatesData).toBe(false)
    expect(findActiveWorkflowDefinition('approved-follow-up-task')?.implementation).toMatchObject({
      mutatesData: true,
      approvalPolicy: 'user_confirmation',
    })
    expect(supportsWorkflowExecution('workflow-registry-health')).toBe(true)
    expect(supportsWorkflowExecution('approved-follow-up-task')).toBe(true)
    expect(supportsWorkflowExecution('ppc-conversion-export')).toBe(false)
  })

  it('starts with a versioned definition snapshot and deterministic hash', async () => {
    const definition = findActiveWorkflowDefinition('workflow-registry-health')!
    const rpc = vi.fn().mockResolvedValue({ data: run({ status: 'queued', attempt_count: 0 }), error: null })
    const result = await startWorkflowRun({
      definition,
      actor: 'Ernest',
      idempotencyKey: 'registry-health:one',
      payload: { source: 'test' },
    }, { rpc } as unknown as SupabaseClient)

    expect(result.status).toBe('queued')
    expect(rpc).toHaveBeenCalledWith('workflow_start_run_v1', expect.objectContaining({
      p_workflow_id: 'workflow-registry-health',
      p_workflow_version: 1,
      p_definition_snapshot: definition,
      p_definition_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_mutates_data: false,
      p_idempotency_key: 'registry-health:one',
      p_requested_by: 'Ernest',
      p_input: { source: 'test' },
    }))
  })

  it('executes registry health and records the step before completion', async () => {
    const running = run()
    const calls: string[] = []
    const rpc = vi.fn(async (name: string) => {
      calls.push(name)
      if (name === 'workflow_claim_specific_run_v1') return { data: running, error: null }
      if (name === 'workflow_record_step_v1') return { data: { id: 'step' }, error: null }
      if (name === 'workflow_finish_run_v2') return { data: run({ status: 'succeeded', output: { healthy: true } }), error: null }
      throw new Error(`Unexpected RPC ${name}`)
    })
    const from = vi.fn((table: string) => {
      expect(table).toBe('system_config')
      return { select: () => ({ like: async () => ({ data: [], error: null }) }) }
    })

    const result = await executeWorkflowRun(running.id, 'worker:test', { rpc, from } as unknown as SupabaseClient)
    expect(result?.status).toBe('succeeded')
    expect(calls).toEqual([
      'workflow_claim_specific_run_v1',
      'workflow_record_step_v1',
      'workflow_finish_run_v2',
    ])
    expect(rpc).toHaveBeenCalledWith('workflow_record_step_v1', expect.objectContaining({
      p_status: 'succeeded',
      p_step_key: 'validate_registry',
      p_output: expect.objectContaining({ healthy: true, validationErrors: 0, duplicateIds: 0 }),
    }))
  })

  it('records a failed step and schedules the database-owned retry outcome', async () => {
    const running = run()
    const rpc = vi.fn(async (name: string) => {
      if (name === 'workflow_claim_specific_run_v1') return { data: running, error: null }
      if (name === 'workflow_record_step_v1') return { data: { id: 'step' }, error: null }
      if (name === 'workflow_finish_run_v2') return { data: run({ status: 'retry_scheduled', error_code: 'workflow_execution_failed' }), error: null }
      throw new Error(`Unexpected RPC ${name}`)
    })
    const from = vi.fn(() => ({ select: () => ({ like: async () => ({ data: null, error: { message: 'registry offline' } }) }) }))

    const result = await executeWorkflowRun(running.id, 'worker:test', { rpc, from } as unknown as SupabaseClient)
    expect(result?.status).toBe('retry_scheduled')
    expect(rpc).toHaveBeenCalledWith('workflow_record_step_v1', expect.objectContaining({
      p_status: 'failed',
      p_error_code: 'workflow_execution_failed',
    }))
    expect(rpc).toHaveBeenCalledWith('workflow_finish_run_v2', expect.objectContaining({
      p_outcome: 'failed',
      p_error_code: 'workflow_execution_failed',
      p_retryable: true,
    }))
  })

  it('creates an approved task exactly once and records its workflow step', async () => {
    const running = run({
      workflow_id: 'approved-follow-up-task',
      approval_policy: 'user_confirmation',
      mutates_data: true,
      input: {
        leadId: '10000000-0000-4000-8000-000000000002',
        title: 'Call seller after attorney review',
        dueAt: '2026-08-22T16:00:00.000Z',
        assignedTo: 'Ernest',
      },
    })
    const calls: string[] = []
    const rpc = vi.fn(async (name: string) => {
      calls.push(name)
      if (name === 'workflow_claim_specific_run_v1') return { data: running, error: null }
      if (name === 'create_work_item_v2') return {
        data: {
          created: true,
          workItem: {
            work_item_key: 'activity:task-1', source_kind: 'activity', source_id: 'task-1',
            lead_id: running.input.leadId, tc_file_id: null, kind: 'follow_up',
            title: running.input.title, description: null, status: 'pending', priority: 'normal',
            due_at: running.input.dueAt, assigned_to: 'Ernest', department: 'acquisitions',
            role: 'setter', primary_next_action: false, version: 1,
            source_created_at: running.created_at, completed_at: null, updated_at: running.updated_at,
          },
        },
        error: null,
      }
      if (name === 'workflow_record_step_v1') return { data: { id: 'step' }, error: null }
      if (name === 'workflow_finish_run_v2') return { data: run({ ...running, status: 'succeeded' }), error: null }
      throw new Error(`Unexpected RPC ${name}`)
    })

    const result = await executeWorkflowRun(running.id, 'worker:test', { rpc } as unknown as SupabaseClient)
    expect(result?.status).toBe('succeeded')
    expect(calls).toEqual([
      'workflow_claim_specific_run_v1',
      'create_work_item_v2',
      'workflow_record_step_v1',
      'workflow_finish_run_v2',
    ])
    expect(rpc).toHaveBeenCalledWith('workflow_record_step_v1', expect.objectContaining({
      p_step_key: 'create_follow_up_task',
      p_idempotency_key: `${running.id}:create_follow_up_task:1`,
    }))
  })
})
