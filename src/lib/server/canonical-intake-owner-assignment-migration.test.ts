import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261007123000_canonical_intake_owner_assignment.sql',
  'utf8',
)

describe('canonical intake owner assignment migration', () => {
  it('locks the compatibility record before deciding whether assignment is allowed', () => {
    expect(migration).toMatch(/SELECT \* INTO lead_row FROM public\.leads WHERE id = target_lead_id FOR UPDATE;/)
    expect(migration).toMatch(/IF nullif\(trim\(lead_row\.assigned_agent\), ''\) IS NOT NULL THEN/)
    expect(migration).toContain("'applied', false")
  })

  it('replays by command id and delegates new assignments to the governed lifecycle ledger', () => {
    expect(migration).toMatch(/WHERE command_id = target_command_id;/)
    expect(migration).toContain('command_result := public.crm_apply_lifecycle_command_v1(')
    expect(migration).toContain("'verified_workflow_event'")
    expect(migration).toContain("command_result || jsonb_build_object('applied', true)")
    expect(migration).not.toMatch(/UPDATE public\.leads SET/)
  })

  it('keeps the workflow boundary service-role-only', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated;/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role;/)
  })
})
