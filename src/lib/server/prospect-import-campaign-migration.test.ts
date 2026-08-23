import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260920120000_atomic_campaign_prospect_import.sql'), 'utf8')

describe('atomic campaign prospect import migration', () => {
  it('keeps contact creation, audit, and enrollment in one server-only command', () => {
    expect(migration).toContain('INSERT INTO public.leads')
    expect(migration).toContain('INSERT INTO public.lead_activities')
    expect(migration).toContain('public.enroll_prospecting_campaign_members_v1')
    expect(migration).toContain("'campaign_audience_imported'")
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
  })

  it('locks campaign ownership and validates the entire bounded batch before inserting', () => {
    expect(migration).toContain('lower(owner_email) = lower(trim(p_actor_email))')
    expect(migration).toContain('FOR UPDATE')
    expect(migration).toContain('requested_count > 500')
    expect(migration).toContain('prospect_import_existing_contact')
    expect(migration).toContain('idx_leads_prospecting_phone')
    expect(migration).toContain('JOIN public.leads lead')
    expect(migration).toContain("campaign_row.status NOT IN ('draft', 'paused')")
  })
})
