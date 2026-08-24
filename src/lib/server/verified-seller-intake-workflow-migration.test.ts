import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261007120000_verified_seller_intake_workflow.sql',
  'utf8',
)

describe('verified seller intake workflow migration', () => {
  it('permits only the exact versioned server-owned seller intake contract', () => {
    expect(migration).toContain("p_workflow_id, '')) <> 'seller-form-intake'")
    expect(migration).toContain('p_workflow_version IS DISTINCT FROM 2')
    expect(migration).toContain("p_trigger_kind, '')) <> 'lead_form_submitted'")
    expect(migration).toContain("p_requested_by, ''))) <> 'savingkc operations'")
    expect(migration).toContain("clean_trigger_key !~ '^seller-form-intake:[a-f0-9]{24}$'")
    expect(migration).toContain("p_definition_snapshot #>> '{implementation,execution}' IS DISTINCT FROM 'worker'")
    expect(migration).toContain("p_definition_snapshot #>> '{implementation,approvalPolicy}' IS DISTINCT FROM 'automatic'")
    expect(migration).toContain("p_definition_snapshot #>> '{implementation,mutatesData}' IS DISTINCT FROM 'true'")
    expect(migration).toContain("p_input ->> 'workflowTriggerKey' IS DISTINCT FROM clean_trigger_key")
    expect(migration).toContain("nullif(trim(coalesce(p_input ->> 'dueAt', '')), '') IS NULL")
  })

  it('delegates creation to the governed generic starter and authorizes only its exact run', () => {
    expect(migration).toContain('created_run := public.workflow_start_run_v1(')
    expect(migration).toMatch(/WHERE id = created_run\.id AND status = 'awaiting_approval'/)
    expect(migration).toContain("'verified_server_event_authorized'")
    expect(migration).toContain("'authority', 'seller_intake_allowlist_v1'")
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.workflow_start_run_v1/)
  })

  it('keeps the starter service-role only', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated;/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role;/)
  })
})
