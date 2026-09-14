import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const original = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260920120000_atomic_campaign_prospect_import.sql'),
  'utf8',
)
const aligned = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261105120000_import_prospecting_campaign_members_schema_align.sql'),
  'utf8',
)

describe('import prospecting campaign members schema alignment', () => {
  it('documents that the original command wrote a leads column that never shipped', () => {
    expect(original).toContain('pipeline_intent_source')
    expect(original).toContain("INSERT INTO public.leads (")
  })

  it('replaces the import command so it only writes current leads columns', () => {
    const functionBody = aligned.slice(aligned.indexOf('CREATE OR REPLACE FUNCTION'))
    expect(functionBody).toContain('CREATE OR REPLACE FUNCTION public.import_prospecting_campaign_members_v1(')
    expect(functionBody).toContain('INSERT INTO public.leads (')
    expect(functionBody).toContain('station, classification, priority, is_parked')
    expect(functionBody).not.toContain('pipeline_intent_source')
    expect(functionBody).toContain('public.enroll_prospecting_campaign_members_v1')
    expect(functionBody).toContain('FROM PUBLIC, anon, authenticated')
    expect(functionBody).toContain('TO service_role')
    expect(aligned).toContain('CREATE OR REPLACE FUNCTION public.enroll_prospecting_campaign_members_v1(')
    expect(aligned).toContain("ON CONFLICT (campaign_id, lead_id) WHERE subject_kind = 'lead'")
    expect(aligned).not.toMatch(/ON CONFLICT \(campaign_id, lead_id\) DO UPDATE/)
    expect(aligned).toContain("OR source::text = %L")
    expect(aligned).toContain("'csv_import'")
    expect(functionBody).toContain("WHEN lower(btrim(row_value.source)) IN ('csv_import', 'contact_csv_import') THEN 'import'")
    expect(functionBody).toContain("WHEN nullif(btrim(row_value.source), '') IS NULL THEN 'import'")
  })
})
