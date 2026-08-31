import fs from 'node:fs'

import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/20261025120000_canonical_property_link_bootstrap.sql'

describe('canonical property link bootstrap migration', () => {
  it('links verified locations without writing provider fields onto leads', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')

    expect(sql).toContain('ensure_crm_property_link_v1')
    expect(sql).toContain("source_value NOT IN ('prospect_match', 'county_assessor')")
    expect(sql).toContain('INSERT INTO public.crm_properties')
    expect(sql).toContain('UPDATE public.crm_lead_entity_links SET')
    expect(sql).toContain('UPDATE public.crm_opportunities SET')
    expect(sql).not.toMatch(/UPDATE\s+public\.leads/i)
  })

  it('preserves a verified property across later identity-shell lead updates', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.refresh_crm_entity_for_lead')
    expect(sql).toContain('preserved_property_id')
    expect(sql).toContain('property_id = coalesce(property_id, preserved_property_id)')
    expect(sql).toContain('primary_property_id = coalesce(')
  })

  it('keeps the command service-role only', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')

    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.ensure_crm_property_link_v1[\s\S]+FROM PUBLIC, anon, authenticated;/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.ensure_crm_property_link_v1[\s\S]+TO service_role;/)
  })

  it('retries only jobs that failed because the bootstrap function was missing', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')

    expect(sql).toContain("WHERE status = 'failed'")
    expect(sql).toContain("last_error LIKE 'Canonical property bootstrap failed:%ensure_crm_property_link_v1%'")
    expect(sql).toContain('attempts = 0')
  })
})
