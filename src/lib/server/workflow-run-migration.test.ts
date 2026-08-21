import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260822120000_workflow_run_governance.sql'), 'utf8')

describe('workflow run governance migration', () => {
  it('creates the version, run, step, approval, and append-only event contracts', () => {
    for (const table of ['workflow_definition_versions', 'workflow_runs', 'workflow_run_steps', 'workflow_approvals', 'workflow_run_events']) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`)
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
    }
    expect(sql).toContain('idempotency_key text NOT NULL UNIQUE')
    expect(sql).toContain("'awaiting_approval', 'queued', 'running', 'retry_scheduled'")
    expect(sql).toContain('definition_snapshot jsonb NOT NULL')
  })

  it('keeps browser roles out and exposes audited functions only to service_role', () => {
    expect(sql).toContain('FROM PUBLIC, anon, authenticated')
    expect(sql).toContain('TO service_role')
    for (const fn of ['workflow_start_run_v1', 'workflow_decide_run_v1', 'workflow_claim_specific_run_v1', 'workflow_record_step_v1', 'workflow_finish_run_v1']) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn}`)
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}`)
    }
  })

  it('forces mutating workflows through approval and owns retry backoff in the database', () => {
    expect(sql).toContain("WHEN p_mutates_data OR p_approval_policy <> 'automatic' THEN 'awaiting_approval'")
    expect(sql).toContain("next_status := 'retry_scheduled'")
    expect(sql).toContain('least(3600, 30 * (2 ^ greatest(target_run.attempt_count - 1, 0))::integer)')
    expect(sql).toContain('FOR UPDATE SKIP LOCKED')
  })
})
