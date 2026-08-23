import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260921120000_county_prospect_audience_read_model.sql'), 'utf8')

describe('county prospect audience read model migration', () => {
  it('requires explicit property evidence and keeps aggregate reads server-only', () => {
    expect(migration).toContain("property_class IN ('residential', 'land', 'unknown')")
    expect(migration).toContain('county_prospect_audience_summary_v1')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.county_prospect_audience_summary_v1()')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
    expect(migration).not.toMatch(/zestimate[^\n]+property_class|occupancy_status[^\n]+property_class/i)
  })
})
