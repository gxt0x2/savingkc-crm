import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TWO_YEAR_PILOT_ID = '5c45d2f7-c120-4477-bb1f-f04d69c4efdf'
const CASEY_TAX_CAMPAIGN_ID = '74609ed4-7e26-4111-b626-b2e3f68efa0b'
const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261024120000_prospect_owner_display_fields.sql'),
  'utf8',
)

describe('prospect owner display field migration', () => {
  it('adds nullable owner and unit display columns only', () => {
    expect(migration).toContain("SET lock_timeout = '10s'")
    expect(migration).toContain("SET statement_timeout = '2min'")
    expect(migration).toContain('ALTER TABLE public.prospects')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS owner_1_mi text')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS owner_1_suffix text')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS situs_unit text')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS mailing_unit text')
    expect(migration).not.toMatch(/NOT NULL/)
    expect(migration).not.toMatch(/\bUPDATE\b/i)
    expect(migration).not.toMatch(/\bDELETE\b/i)
  })

  it('does not recut live campaigns, drain Mojo, or guess CRON_SECRET', () => {
    expect(migration).not.toContain(TWO_YEAR_PILOT_ID)
    expect(migration).not.toContain(CASEY_TAX_CAMPAIGN_ID)
    expect(migration).not.toMatch(/mojo_call_queue/)
    expect(migration).not.toMatch(/CRON_SECRET/)
    expect(migration).not.toMatch(/skip.?trace/i)
  })
})
