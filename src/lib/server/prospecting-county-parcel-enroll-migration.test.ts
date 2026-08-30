import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TWO_YEAR_PILOT_ID = '5c45d2f7-c120-4477-bb1f-f04d69c4efdf'
const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261023120000_enroll_county_prospects_by_parcel_ids.sql'),
  'utf8',
)
const savedView = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261006120000_prospecting_campaign_subjects.sql'),
  'utf8',
)

describe('county parcel-id campaign enrollment', () => {
  it('copies saved-view snapshot and suppression rules onto an exact Jackson parcel list', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.enroll_county_prospecting_campaign_members_by_ids_v1(')
    expect(migration).toContain('p_parcel_ids text[]')
    expect(migration).toContain('p_reviewed_count integer')
    expect(migration).toContain("lower(trim(coalesce(prospect.county, ''))) = 'jackson'")
    expect(migration).toContain('requested.parcel_id = prospect.parcel_id')
    expect(migration).not.toContain('delinquent_years_category')
    expect(migration).not.toContain('p_saved_view')
    expect(migration).toContain("enrollment_source,")
    expect(migration).toContain("'county_saved_view'")
    expect(migration).toContain("'prospect'")
    expect(migration).toContain('selected_for_sms = false')
    expect(migration).toContain('JOIN public.prospect_phones phone ON phone.prospect_id = selected.prospect_id')
    expect(migration).not.toMatch(/INSERT INTO public\.leads/)
  })

  it('rejects a drifted reviewed count and locks active campaigns the same way as Saved Views', () => {
    expect(migration).toContain("coalesce(array_length(p_parcel_ids, 1), 0) IS DISTINCT FROM p_reviewed_count")
    expect(migration).toContain("IF requested_count IS DISTINCT FROM p_reviewed_count THEN RAISE EXCEPTION 'county_audience_changed'")
    expect(migration).toContain("IF matched_count IS DISTINCT FROM p_reviewed_count THEN RAISE EXCEPTION 'county_audience_changed'")
    expect(migration).toContain("campaign_row.status NOT IN ('draft', 'paused')")
    expect(migration).toContain('RAISE EXCEPTION \'campaign_members_locked\'')
    expect(savedView).toContain("IF matched_count IS DISTINCT FROM p_reviewed_count THEN RAISE EXCEPTION 'county_audience_changed'")
    expect(savedView).toContain("campaign_row.status NOT IN ('draft', 'paused')")
  })

  it('keeps the command service-only and never targets the 2-year pilot id', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.enroll_county_prospecting_campaign_members_by_ids_v1')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
    expect(migration).not.toContain(TWO_YEAR_PILOT_ID)
    expect(migration).not.toContain('mojo_call_queue')
    expect(migration).not.toContain('CRON_SECRET')
  })
})
