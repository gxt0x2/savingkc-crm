import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261203120000_mortgage_foreclosure_intake.sql'), 'utf8')

describe('mortgage foreclosure intake migration', () => {
  it('stages pulls, seeds paused counties, and leaves the live filings rows alone', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.mortgage_foreclosure_intake')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.mortgage_foreclosure_intake_sources')
    expect(migration).toContain('source_name')
    expect(migration).toContain('source_url')
    expect(migration).toContain('pull_date')
    expect(migration).toContain('raw_payload')
    expect(migration).toContain('notice_timeline')
    expect(migration).toContain('unit_key')
    expect(migration).toContain('match_flag')
    expect(migration).toContain('identity_conflict')
    expect(migration).toContain("'jackson'), ('clay'), ('platte'), ('johnson'), ('wyandotte')")
    expect(migration).toContain('paused')
    expect(migration).toContain('ON CONFLICT (county, notice_type) DO NOTHING')
    expect(migration).toContain("'mopublicnotices_smart_search'")
    expect(migration).toContain('true, false')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('GRANT ALL ON TABLE public.mortgage_foreclosure_intake TO service_role')
    expect(migration).not.toMatch(/UPDATE\s+public\.mortgage_foreclosure_prospects/i)
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.mortgage_foreclosure_prospects/i)
  })
})
