import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261016120000_dialer_stop_request_lifecycle.sql',
  'utf8',
)

describe('dialer stop-request lifecycle migration', () => {
  it('persists the stop request and exposes it in canonical session state', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS stop_requested_at timestamptz')
    expect(migration).toContain("'stopRequestedAt', p_session.stop_requested_at")
    expect(migration).toContain("p_action = 'request_stop'")
    expect(migration).toContain("event_name := 'session_stop_requested'")
  })

  it('blocks new calls and converts stale advance attempts into a stop', () => {
    expect(migration).toContain("IF session_row.stop_requested_at IS NOT NULL THEN RAISE EXCEPTION 'session_stop_requested'")
    expect(migration).toMatch(/IF session_row\.stop_requested_at IS NOT NULL THEN[\s\S]*SET status = 'stopped'/)
    expect(migration).toContain("'session_stop', 'Stop finalized after call outcome'")
  })

  it('keeps all lifecycle RPCs service-role only', () => {
    expect(migration.match(/REVOKE ALL ON FUNCTION/g)).toHaveLength(4)
    expect(migration.match(/TO service_role/g)).toHaveLength(4)
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
  })
})
