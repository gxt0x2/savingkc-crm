import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260820120000_dialer_session_engine.sql'),
  'utf8',
)

describe('dialer session migration contract', () => {
  it('enforces one open session and one open attempt per session', () => {
    expect(migration).toContain('idx_dialer_sessions_one_open_per_actor')
    expect(migration).toContain("status IN ('active', 'paused')")
    expect(migration).toContain('idx_dialer_attempts_one_open_per_session')
    expect(migration).toContain("status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition')")
  })

  it('requires disposition before the only attempt-driven advance', () => {
    expect(migration).toContain("IF v_attempt.status <> 'dispositioned' THEN RAISE EXCEPTION 'disposition_required'")
    expect(migration).toContain('IF v_attempt.advanced_at IS NOT NULL THEN')
    expect(migration).toContain('UPDATE public.dialer_session_attempts SET advanced_at = now()')
  })

  it('keeps tables and state-changing functions server-only', () => {
    expect(migration).toContain('REVOKE ALL ON TABLE public.dialer_session_attempts FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('REVOKE ALL ON TABLE public.dialer_sessions, public.dialer_session_events FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.start_dialer_session_v1')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.advance_dialer_session_v1')
  })

  it('locks session creation by verified actor and session transitions by row', () => {
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dialer-actor:' || v_actor, 0))")
    expect(migration.match(/FOR UPDATE;/g)?.length).toBeGreaterThanOrEqual(5)
  })
})
