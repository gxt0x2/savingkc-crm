import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261030130000_mojo_governed_exceptions_and_followups.sql',
  'utf8',
)

describe('Mojo governed exceptions and follow-up migration', () => {
  it('requires a documented exception before negative intent can be overridden', () => {
    expect(migration).toContain("p_call->>'qualification_override_reason'")
    expect(migration).toContain('qualified_by_agent AND qualification_override_reason IS NOT NULL')
    expect(migration).toContain("'negative_intent_overridden'")
    expect(migration).toContain("'qualification_override_reason', qualification_override_reason")
  })

  it('creates contact identity for a real follow-up without granting promotion authority', () => {
    expect(migration).toContain("provider_outcome IN ('callback_scheduled', 'meaningful_conversation')")
    expect(migration).toContain("p_follow_up_at >= clock_timestamp() - interval '5 minutes'")
    expect(migration).toContain('promotion_value OR scheduled_follow_up')
    expect(migration).not.toContain('promotion_value := scheduled_follow_up')
  })

  it('retains service-role-only execution and advances the policy version', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.ingest_crm_mojo_call_v1[\s\S]+FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.ingest_crm_mojo_call_v1[\s\S]+TO service_role/)
    expect(migration).toContain('mojo_qualification_v1_2')
  })
})
