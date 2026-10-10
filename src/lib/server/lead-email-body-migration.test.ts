import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261125120000_lead_emails_body_text.sql',
  'utf8',
)

describe('lead email body migration', () => {
  it('adds a nullable body_text column to the existing lead_emails table', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS body_text text')
    expect(migration).toContain("to_regclass('public.lead_emails')")
    expect(migration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA)|CREATE\s+TABLE)\b/i)
  })
})
