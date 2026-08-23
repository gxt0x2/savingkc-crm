import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260918120000_dialer_attempt_evidence_idempotency.sql',
), 'utf8')

describe('dialer attempt evidence schema', () => {
  it('uniquely binds each evidence kind to a durable dial attempt', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_activities_dial_attempt_evidence')
    expect(migration).toContain("metadata ->> 'client_attempt_id'")
    expect(migration).toContain("COALESCE(metadata ->> 'action', '')")
    expect(migration).toContain("'telephony_bar', 'call_disposition', 'heir_dialer'")
  })
})
