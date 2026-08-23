import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/20260911120000_primary_next_action_controlled_repair.sql'
const sql = readFileSync(migrationPath, 'utf8')

describe('controlled primary next-action repair migration', () => {
  it('keeps migration application non-mutating and the explicit repair fingerprint locked', () => {
    expect(sql).not.toMatch(/^\s*SELECT\s+public\.promote_existing_operator_primary_next_actions_v1/im)
    expect(sql).toContain("RAISE EXCEPTION 'repair_census_drift'")
    expect(sql).toContain("RAISE EXCEPTION 'repair_candidate_fingerprint_drift'")
    expect(sql).toContain("candidate.provenance_class IN ('governed_human', 'legacy_operator')")
    expect(sql).toContain('counts.candidate_count = 1')
    expect(sql).toContain('LOCK TABLE public.lead_activities IN SHARE ROW EXCLUSIVE MODE')
    expect(sql).toContain("set_config('lock_timeout', '5s', true)")
  })

  it('changes only the source task and writes an immutable audit event', () => {
    expect(sql).toContain('UPDATE public.lead_activities AS activity')
    expect(sql).toContain("'primary_next_action_repair', 'existing_operator_task_v1'")
    expect(sql).toContain("'promote_primary_next_action'")
    expect(sql).toContain("'exactly_one_trustworthy_operator_task'")
    expect(sql).not.toMatch(/SET\s+(description|agent|lead_id|activity_type)\s*=/i)
  })

  it('supports safe retry and fingerprint-locked immediate rollback', () => {
    expect(sql).toContain("'alreadyApplied', true")
    expect(sql).toContain("RAISE EXCEPTION 'repair_partial_state_detected'")
    expect(sql).toContain("RAISE EXCEPTION 'rollback_state_drift'")
    expect(sql).toContain("'rollback_primary_next_action_promotion'")
  })

  it('keeps all census and mutation entrypoints server-only', () => {
    for (const signature of [
      'primary_next_action_repair_census_v1\\(\\)',
      'promote_existing_operator_primary_next_actions_v1\\([\\s\\S]*integer, integer, text, text[\\s\\S]*\\)',
      'rollback_existing_operator_primary_next_actions_v1\\([\\s\\S]*integer, text, text, text[\\s\\S]*\\)',
    ]) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature}[\\s\\S]*FROM PUBLIC, anon, authenticated`))
    }
  })
})
