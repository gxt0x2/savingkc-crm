import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261122120000_mobile_voice_attempt_ledger.sql',
  'utf8',
)

describe('mobile voice attempt ledger migration', () => {
  it('keys every attempt by SDK identity so agents never share a row', () => {
    expect(migration).toContain('PRIMARY KEY (agent_identity, client_attempt_id)')
    expect(migration).toContain("CHECK (source IS NULL OR source IN ('mobile_manual', 'mobile_lead'))")
    expect(migration).toContain('ON CONFLICT (agent_identity, client_attempt_id) DO UPDATE')
  })

  it('keeps the first provider parent and never clears a stored End', () => {
    expect(migration).toContain('parent_call_sid = coalesce(attempt.parent_call_sid, EXCLUDED.parent_call_sid)')
    expect(migration).toContain('end_requested_at = coalesce(attempt.end_requested_at, EXCLUDED.end_requested_at)')
    expect(migration).not.toMatch(/end_requested_at\s*=\s*NULL/i)
  })

  it('is service-role only', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL ON public.mobile_voice_attempts FROM anon, authenticated')
    expect(migration.match(/SECURITY DEFINER SET search_path = pg_catalog, public/g)).toHaveLength(2)
    expect(migration.match(/REVOKE ALL ON FUNCTION/g)).toHaveLength(2)
    expect(migration.match(/FROM PUBLIC, anon, authenticated/g)).toHaveLength(2)
    expect(migration.match(/GRANT EXECUTE ON FUNCTION [^;]+ TO service_role/g)).toHaveLength(2)
  })

  it('is additive', () => {
    expect(migration).not.toMatch(/\b(?:DROP|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE\s+public\.(?!mobile_voice_attempts))/i)
  })
})
