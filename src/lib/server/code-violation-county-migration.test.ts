import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261115012108_code_violation_county_backfill.sql'),
  'utf8',
)

describe('code violation county backfill', () => {
  it('places matched rows from the parcel-match key and writes situs_county', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.source_list_parcel_match_county_v1')
    expect(migration).toContain("WHEN key ~ '(^|_)jackson($|_)' THEN 'jackson'")
    expect(migration).toContain("WHEN key ~ '(^|_)clay($|_)' THEN 'clay'")
    expect(migration).toContain("WHEN key ~ '(^|_)platte($|_)' THEN 'platte'")
    expect(migration).toContain("jsonb_build_object('situs_county', matched.county)")
    expect(migration).toContain('public.source_list_parcel_match_county_v1(raw)')
    expect(migration).toContain("AND (row.county IS NULL OR nullif(btrim(row.raw->>'situs_county'), '') IS NULL)")
    expect(migration).toContain('Dry run (read only)')
  })

  it('leaves the dialer review view to #814 and snapshots prospect county first', () => {
    expect(migration).not.toContain('CREATE OR REPLACE VIEW public.source_list_dialer_phone_review')
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1')
    expect(migration).not.toContain('source_list_phone_block_reasons_v1')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.prospect_county_backfill_snapshot')
    const snapshot = migration.indexOf('INSERT INTO public.prospect_county_backfill_snapshot')
    const update = migration.indexOf('UPDATE public.prospects AS prospect')
    expect(snapshot).toBeGreaterThan(0)
    expect(update).toBeGreaterThan(snapshot)
    expect(migration).toContain('ON CONFLICT (prospect_id) DO NOTHING')
    expect(migration).toContain('county_unresolved')
    expect(migration).not.toMatch(/\b(?:insert|update|delete|from|join|into|truncate)\s+(?:public\.)?mojo_call_queue\b/i)
  })

  it('normalizes prospect county and leaves unresolved rows explicit', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.service_county_from_situs_v1')
    expect(migration).toContain('64155')
    expect(migration).toContain('64163')
    expect(migration).toContain('64118')
    expect(migration).toContain("'unresolved'")
    expect(migration).toContain('prospects_county_canonical_check')
    expect(migration).toContain("county IS NOT NULL")
    expect(migration).toContain("IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte', 'unresolved')")
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF county ON public.prospects')
    expect(migration).toContain("'belton'")
    expect(migration).toContain('64012')
    expect(migration).not.toContain('64083) THEN \'platte\'')
  })

  it('keeps new code-violation rows new, dedupes on the case, and chunks at 5000', () => {
    expect(migration).toContain("'code_violation'")
    expect(migration).toContain('source_list_rows_code_case_key')
    expect(migration).toContain("WHEN v_lane.list_type = 'code_violation' THEN 'new'")
    expect(migration).toContain("THEN 'out_of_area'")
    expect(migration).toContain('open_to_entry')
    expect(migration).toContain('nuisance')
    expect(migration).toContain('jsonb_array_length(p_rows) > 5000')
    expect(migration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b/i)
  })
})