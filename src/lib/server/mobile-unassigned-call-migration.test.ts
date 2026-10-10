import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261123120000_mobile_unassigned_call_outcome.sql',
  'utf8',
)

describe('mobile unassigned call outcome migration', () => {
  it('idempotently keys an unassigned mobile call by agent, phone, and clientCallId', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_activities_mobile_unassigned_call')
    expect(migration).toContain("(metadata ->> 'userId')")
    expect(migration).toContain("(metadata ->> 'phone')")
    expect(migration).toContain("(metadata ->> 'clientCallId')")
    expect(migration).toContain('lead_id IS NULL')
    expect(migration).toContain("metadata ->> 'source' = 'savingkc_mobile'")
  })

  it('is additive and does not create another DNC table', () => {
    expect(migration).not.toMatch(/\b(?:DROP|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|CREATE\s+TABLE)\b/i)
    expect(migration).not.toMatch(/\b(?:leads|prospects|prospect_phones|sms_opt_outs)\b/)
  })
})
