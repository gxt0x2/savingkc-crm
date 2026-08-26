import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20261019120000_prospecting_dialer_session_setup.sql',
), 'utf8')

describe('prospecting dialer session setup migration', () => {
  it('persists the caller plan and bounded agent setup in the session snapshot', () => {
    expect(migration).toContain("'settingsSnapshot', coalesce(p_session.settings_snapshot")
    expect(migration).toContain("'prospectingSession', setup")
    expect(migration).toContain("'ringCount', ring_count")
    expect(migration).toContain("'callerPlan', jsonb_build_object")
    expect(migration).toContain("'rotateEveryCalls', 1")
  })

  it('keeps queue creation and final attempt authorization under the same eligibility rules', () => {
    expect(migration).toContain('public.prospecting_dialer_phone_is_eligible_v1(contact.phone_snapshot, setup)')
    expect(migration).toContain('IF NOT public.prospecting_dialer_phone_is_eligible_v1(p_phone, setup)')
    expect(migration).not.toContain("RAISE EXCEPTION 'dialer_attempt_limit'")
    expect(migration).toContain("RAISE EXCEPTION 'dialer_recently_contacted'")
    expect(migration).toContain("RAISE EXCEPTION 'dialer_recently_dialed'")
  })

  it('allows only one-line cold-call identities and keeps all new boundaries server-only', () => {
    expect(migration).toContain("'+18163100845'")
    expect(migration).toContain("cardinality(caller_ids) > (CASE WHEN caller_mode = 'rotation' THEN 5 ELSE 1 END)")
    expect(migration).toContain("'mode', caller_mode")
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v4')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.authorize_dialer_attempt_v3')
    expect(migration).toContain('TO service_role')
  })
})
