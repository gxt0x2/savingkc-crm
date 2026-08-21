import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260831120000_workflow_task_executor.sql'),
  'utf8',
)

describe('workflow task executor migration', () => {
  it('creates a provenance-aware idempotent work-item boundary', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.create_work_item_v2')
    expect(sql).toContain("pg_advisory_xact_lock(pg_catalog.hashtextextended('work-item-idempotency:' || clean_key, 0))")
    expect(sql).toContain("'source', 'governed_workflow'")
    expect(sql).toContain("provenance_value || jsonb_build_object(")
    expect(sql).toContain("RETURN jsonb_build_object('created', false, 'workItem', to_jsonb(item))")
  })

  it('lets deterministic failures exhaust immediately while transient failures back off', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.workflow_finish_run_v2')
    expect(sql).toContain('ELSIF coalesce(p_retryable, true) AND target_run.attempt_count < target_run.max_attempts THEN')
    expect(sql).toContain("next_status := 'retry_scheduled'")
    expect(sql).toContain("'retryable', coalesce(p_retryable, true)")
  })

  it('keeps both functions service-role only', () => {
    for (const fn of ['create_work_item_v2', 'workflow_finish_run_v2']) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn}`)
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}`)
    }
    expect(sql).toContain('FROM PUBLIC, anon, authenticated')
  })
})
