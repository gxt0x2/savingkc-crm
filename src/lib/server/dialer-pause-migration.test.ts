import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261018120000_dialer_pause_request_lifecycle.sql', 'utf8')

describe('durable dialer pause request migration', () => {
  it('locks the session, makes it non-callable, and preserves an open attempt for one outcome', () => {
    expect(migration).toContain('FOR UPDATE')
    expect(migration).toContain("status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition')")
    expect(migration).toContain("SET status = 'paused'")
    expect(migration).toContain("'requiresDisposition', open_attempt")
    expect(migration).toContain("'session_pause_requested'")
  })

  it('is service-role only', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/)
  })
})
