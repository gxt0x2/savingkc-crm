import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261028120000_stale_paused_dialer_session.sql', 'utf8')
const resumeMigration = readFileSync('supabase/migrations/20261017120000_prospecting_dialer_resume_modes.sql', 'utf8')
const setupMigration = readFileSync('supabase/migrations/20261019120000_prospecting_dialer_session_setup.sql', 'utf8')
const leaseMigration = readFileSync('supabase/migrations/20261026120000_dialer_session_control_lease.sql', 'utf8')

describe('stale paused dialer session migration', () => {
  it('keeps a paused open row as the one-session lock that blocks campaign switch', () => {
    expect(resumeMigration).toContain("status IN ('active', 'paused')")
    expect(resumeMigration).toContain('open_session.prospecting_campaign_id IS DISTINCT FROM p_campaign_id')
    expect(resumeMigration).toContain("RAISE EXCEPTION 'another_dialer_session_open'")
    expect(setupMigration).toContain("status IN ('active', 'paused')")
    expect(setupMigration).toContain("RAISE EXCEPTION 'another_dialer_session_open'")
    expect(leaseMigration).toContain('IF p_takeover THEN')
    expect(leaseMigration).toContain("RAISE EXCEPTION 'another_dialer_session_open'")
    expect(migration).toContain("RAISE EXCEPTION 'another_dialer_session_open'")
    expect(migration).toContain('open_session.prospecting_campaign_id IS DISTINCT FROM p_campaign_id')
  })

  it('treats zero Chicago-day attempts or a 15-minute pause SLA as stale', () => {
    expect(migration).toContain("p_session.status = 'paused'")
    expect(migration).toContain('p_session.ended_at IS NULL')
    expect(migration).toContain("timezone('America/Chicago', now())")
    expect(migration).toContain("interval '15 minutes'")
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.dialer_session_is_stale_paused_v1')
  })

  it('blocks new starts on a stale paused actor or campaign row until it is cleared', () => {
    expect(migration).toContain("RAISE EXCEPTION 'stale_paused_session_blocks_start'")
    expect(migration).toContain('public.dialer_session_is_stale_paused_v1(open_session)')
    expect(migration).toContain('other.prospecting_campaign_id = p_campaign_id')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.start_prospecting_dialer_session_v5')
  })

  it('clears only a stale paused session and never drains mojo_call_queue', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.clear_stale_paused_dialer_session_v1')
    expect(migration).toContain("RAISE EXCEPTION 'session_not_stale_paused'")
    expect(migration).toContain("SET status = 'stopped'")
    expect(migration).toContain("'cleared_stale_paused', true")
    expect(migration).toContain("'mojo_call_queue_drained', false")
    expect(migration).not.toMatch(/FROM public\.mojo_call_queue|UPDATE public\.mojo_call_queue|INTO public\.mojo_call_queue/)
    expect(migration).not.toContain('CRON_SECRET')
    expect(migration).not.toContain('74609ed4')
  })

  it('keeps every new boundary service-role only', () => {
    for (const signature of [
      'dialer_session_is_stale_paused_v1',
      'list_stale_paused_dialer_sessions_v1',
      'clear_stale_paused_dialer_session_v1',
      'start_prospecting_dialer_session_v5',
    ]) {
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature}[\\s\\S]*?FROM PUBLIC, anon, authenticated`))
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature}[\\s\\S]*?TO service_role`))
    }
  })
})
