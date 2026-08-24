import fs from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = fs.readFileSync('supabase/migrations/20260927120000_crm_property_enrichment_evidence.sql', 'utf8')

describe('canonical property enrichment migration', () => {
  it('stores typed property facts and immutable provider provenance atomically', () => {
    expect(source).toContain('CREATE TABLE IF NOT EXISTS public.crm_property_enrichment_events')
    expect(source).toContain('CREATE OR REPLACE FUNCTION public.record_crm_property_enrichment_v1')
    expect(source).toContain('pg_advisory_xact_lock')
    expect(source).toContain('unsupported_enrichment_fact')
    expect(source).toContain("source_value || '|' || mode_value")
    expect(source).toContain("coalesce(source_reference_value, '')")
    expect(source).toContain('owner_is_deceased')
    expect(source).toContain('data_enriched_at')
  })

  it('keeps evidence and mutation private to the service boundary', () => {
    expect(source).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(source).toMatch(/REVOKE ALL ON TABLE[\s\S]+FROM PUBLIC, anon, authenticated/)
    expect(source).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC, anon, authenticated/)
    expect(source).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]+TO service_role/)
    expect(source).not.toMatch(/\bmanifests?\b/i)
  })
})
