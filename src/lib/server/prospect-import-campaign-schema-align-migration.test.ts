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
    expect(aligned).toContain('CREATE OR REPLACE FUNCTION public.import_prospecting_campaign_members_v1(')
    expect(aligned).toContain('INSERT INTO public.leads (')
    expect(aligned).toContain('station, classification, priority, is_parked')
    expect(aligned).not.toContain('pipeline_intent_source')
    expect(aligned).toContain('public.enroll_prospecting_campaign_members_v1')
    expect(aligned).toContain('FROM PUBLIC, anon, authenticated')
    expect(aligned).toContain('TO service_role')
  })
})
