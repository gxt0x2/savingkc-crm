import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261203120000_caller_id_reputation_log.sql',
  'utf8',
)

describe('caller id reputation log migration', () => {
  it('creates the append-only log with the reputation columns and phone index', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.caller_id_reputation_log')
    for (const column of [
      'id uuid PRIMARY KEY DEFAULT gen_random_uuid()',
      'checked_at timestamptz NOT NULL DEFAULT now()',
      'phone_e164 text NOT NULL',
      'number_label text',
      'mojo_verified boolean',
      'reputation_guard_status text',
      'voice_integrity_attached boolean',
      'dials_today integer',
      'connect_rate numeric',
      'connect_rate_5d numeric',
      'short_call_share numeric',
      'flag_reason text',
      'action_taken text',
      'action_result text',
      'consecutive_clean integer',
      'fix_attempts integer',
      'decision_needed boolean NOT NULL DEFAULT false',
      'notes text',
      'raw jsonb',
    ]) {
      expect(migration).toContain(column)
    }
    expect(migration).toContain("check_slot IS NULL OR check_slot IN ('am', 'pm', 'adhoc')")
    expect(migration).toContain("last_attestation IS NULL OR last_attestation IN ('A', 'B', 'C', 'none')")
    expect(migration).toContain("rotation_state IS NULL OR rotation_state IN ('active', 'resting')")
    expect(migration).toContain('caller_id_reputation_log_phone_checked_at_idx')
    expect(migration).toContain('ON public.caller_id_reputation_log (phone_e164, checked_at DESC)')
  })

  it('lets the service role insert and read, and lets admins read', () => {
    expect(migration).toContain('ALTER TABLE public.caller_id_reputation_log ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('GRANT SELECT, INSERT ON TABLE public.caller_id_reputation_log TO service_role')
    expect(migration).toContain('GRANT SELECT ON TABLE public.caller_id_reputation_log TO authenticated')
    expect(migration).toContain('FOR INSERT')
    expect(migration).toContain('TO service_role')
    expect(migration).toContain('FOR SELECT')
    expect(migration).toContain('TO authenticated')
    expect(migration).toContain('USING (private.is_caller_id_reputation_admin())')
    expect(migration).toContain('COALESCE(profile.is_admin, false)')
    expect(migration).toContain("lower(COALESCE(profile.role, '')) = 'owner'")
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toContain('SET search_path = pg_catalog, public')
    expect(migration).toContain('REVOKE ALL ON FUNCTION private.is_caller_id_reputation_admin() FROM PUBLIC, anon, authenticated, service_role')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION private.is_caller_id_reputation_admin() TO authenticated')
  })

  it('has no update or delete path', () => {
    expect(migration).not.toMatch(/^\s*(?:CREATE\s+POLICY[\s\S]*?FOR\s+(UPDATE|DELETE|ALL)|GRANT\s+(UPDATE|DELETE|ALL)\b)/im)
    expect(migration).toContain('caller_id_reputation_log must stay append-only')
    expect(migration).toContain('caller_id_reputation_log rejects mutations')
    expect(migration).not.toMatch(/^\s*(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/im)
  })

  it('exposes the latest row per number without touching dialer or messaging tables', () => {
    expect(migration).toContain('CREATE OR REPLACE VIEW public.caller_id_reputation_latest')
    expect(migration).toContain('WITH (security_invoker = true)')
    expect(migration).toContain('SELECT DISTINCT ON (phone_e164)')
    expect(migration).toContain('ORDER BY phone_e164, checked_at DESC, id DESC')
    expect(migration).toContain('GRANT SELECT ON TABLE public.caller_id_reputation_latest TO authenticated, service_role')
    expect(migration).not.toMatch(/\b(?:mojo_call_queue|dialer_sessions|dialer_session_attempts)\b/)
  })
})
