import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261124120000_mobile_manual_lead_source.sql',
  'utf8',
)

describe('mobile manual lead source migration', () => {
  it('widens the installed source check with mobile_manual and keys create retries', () => {
    expect(migration).toContain('OR source::text = %L')
    expect(migration).toContain("'mobile_manual'")
    expect(migration).toContain('NOT LIKE \'%mobile_manual%\'')
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_activities_mobile_manual_contact')
    expect(migration).toContain("(metadata ->> 'userId')")
    expect(migration).toContain("(metadata ->> 'clientRequestId')")
    expect(migration).toContain("metadata ->> 'source' = 'mobile_manual'")
  })

  it('does not replace the source allowlist or delete rows', () => {
    expect(migration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA)|CREATE\s+TABLE)\b/i)
    expect(migration).not.toContain("'manual'")
    expect(migration).toContain('hygiene-approved-destructive:')
  })
})
