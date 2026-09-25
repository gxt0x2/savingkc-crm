import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261114120000_mortgage_foreclosure_prospects.sql'), 'utf8')
const coordinates = readFileSync(join(process.cwd(), 'supabase/migrations/20261115120000_mortgage_foreclosure_coordinates.sql'), 'utf8')
const noticesSent = readFileSync(join(process.cwd(), 'supabase/migrations/20261116120000_mortgage_foreclosure_notices_sent.sql'), 'utf8')
const noticeFile = readFileSync(join(process.cwd(), 'supabase/migrations/20261117120000_mortgage_foreclosure_notice_file.sql'), 'utf8')
const countyEnrollment = readFileSync(join(process.cwd(), 'supabase/migrations/20261023120000_enroll_county_prospects_by_parcel_ids.sql'), 'utf8')

describe('mortgage foreclosure migration', () => {
  it('stores mortgage notices apart from tax delinquency and allows only SmartSkip phones', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.mortgage_foreclosure_prospects')
    expect(migration).toContain("skiptrace_vendor IS NULL OR skiptrace_vendor = 'smartskip'")
    expect(migration).toContain('tax_or_dlt_flag = false')
    expect(migration).toContain("'callable'")
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('GRANT ALL ON TABLE public.mortgage_foreclosure_prospects TO service_role')
    expect(migration).not.toMatch(/INSERT INTO public\.prospects/i)
    expect(migration).not.toContain('delinquent_years_category IN')
  })

  it('keeps foreclosure dialing copies from matching county tax parcel enrollment', () => {
    expect(migration).toContain("prospect_track IN ('tax', 'mortgage_foreclosure')")
    expect(migration).toContain("parcel_id LIKE 'mfc:%'")
    expect(migration).toContain("delinquent_years_category NOT IN ('2yr', '3yr_plus')")
    expect(countyEnrollment).toContain("lower(trim(coalesce(prospect.county, ''))) = 'jackson'")
    expect(countyEnrollment).toContain('requested.parcel_id = prospect.parcel_id')
  })

  it('adds optional coordinates without seeding a person', () => {
    expect(coordinates).toContain('ADD COLUMN IF NOT EXISTS latitude')
    expect(coordinates).toContain('ADD COLUMN IF NOT EXISTS longitude')
    expect(coordinates).toContain('latitude BETWEEN -90 AND 90')
    expect(coordinates).not.toMatch(/INSERT INTO/i)
  })

  it('stores a notices-sent count that defaults to zero', () => {
    expect(noticesSent).toContain('ADD COLUMN IF NOT EXISTS notices_sent integer NOT NULL DEFAULT 0')
    expect(noticesSent).toContain('notices_sent >= 0 AND notices_sent <= 999')
    expect(noticesSent).not.toMatch(/INSERT INTO/i)
  })

  it('stores the living notice file, outreach alias, and county ingest watermark', () => {
    expect(noticeFile).toContain('ADD COLUMN IF NOT EXISTS outreach_count integer')
    expect(noticeFile).toContain('notices_sent')
    expect(noticeFile).toContain('sync_mortgage_foreclosure_outreach')
    expect(noticeFile).toContain("'lis_pendens', 'nod', 'notice_of_sale', 'sheriff_sale'")
    expect(noticeFile).toContain('notice_timeline')
    expect(noticeFile).toContain('CREATE TABLE IF NOT EXISTS public.mortgage_foreclosure_ingest_controls')
    expect(noticeFile).toContain('updated_since')
    expect(noticeFile).toContain('Relatives skip is intentionally not stored')
    expect(noticeFile).not.toMatch(/INSERT INTO/i)
  })
})
