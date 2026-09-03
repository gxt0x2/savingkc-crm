import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261029123000_prospecting_call_report_sorting.sql', 'utf8')

describe('Prospecting call report sorting migration', () => {
  it('keeps the sortable report service-only and layered on the authorized v2 report', () => {
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toContain('base_report := public.prospecting_campaign_call_report_v2(')
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.prospecting_campaign_call_report_v3[\s\S]+FROM PUBLIC, anon, authenticated;/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.prospecting_campaign_call_report_v3[\s\S]+TO service_role;/)
  })

  it('uses allowlisted deterministic server sort plans before pagination', () => {
    expect(migration).toContain("sort_key NOT IN ('called', 'campaign', 'seller', 'number', 'result', 'agent', 'run', 'duration', 'caller')")
    expect(migration).toContain("direction_key NOT IN ('asc', 'desc')")
    expect(migration).toContain("CASE WHEN sort_key = 'result' AND direction_key = 'asc'")
    expect(migration).toContain("CASE WHEN sort_key = 'duration' AND direction_key = 'desc'")
    expect(migration).toContain('attempt.id DESC')
    expect(migration.indexOf('row_number() OVER')).toBeLessThan(migration.indexOf('LIMIT p_limit'))
  })
})
