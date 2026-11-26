import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261222140002_mojo_named_callback_identity_shell.sql',
  'utf8',
)

describe('named Mojo callback identity shell', () => {
  it('opens a non-pipeline shell for a named callback with no follow-up time', () => {
    expect(migration).toContain("provider_outcome = 'callback_scheduled' AND p_follow_up_at IS NULL")
    expect(migration).toContain("p_call->>'lead_exists'")
    expect(migration).toContain('promotion_value OR scheduled_follow_up OR named_identity_shell')
    expect(migration).toContain('callback_without_scheduled_time')
    expect(migration).not.toContain('promotion_value := named_identity_shell')
    expect(migration).not.toContain('promotion_value := true')
  })

  it('keeps DNC and TCPA opt-outs from opening that shell and leaves identity matching in the core', () => {
    expect(migration).toContain("provider_outcome IS DISTINCT FROM 'dnc'")
    expect(migration).toContain("NOT LIKE '%dnc%'")
    expect(migration).toContain("NOT LIKE '%do not call%'")
    expect(migration).toContain('public.sms_opt_outs')
    expect(migration).toContain("p_outcome IS DISTINCT FROM 'dnc'")
    expect(migration).toContain("lower(name_value) NOT IN ('unknown', 'mojo lead')")
    expect(migration).not.toMatch(/out_of_service_area|service_area/)
    expect(migration).not.toMatch(/\b(?:from|into|update|join)\s+(?:public\.)?mojo_call_queue\b/i)
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
  })

  it('locks the core down and advances the qualification version without granting a new public entry point', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.ingest_crm_mojo_call_core_v1[\s\S]+FROM PUBLIC, anon, authenticated, service_role/)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.ingest_crm_mojo_call_governed_v1[\s\S]+FROM PUBLIC, anon, authenticated/)
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.ingest_crm_mojo_call_governed_v1/)
    expect(migration).toContain('mojo_qualification_v1_3')
  })
})
