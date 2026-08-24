import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261006120000_prospecting_campaign_subjects.sql',
  'utf8',
)
const acceptance = readFileSync('docs/prospecting-v1-acceptance.md', 'utf8')

describe('prospecting campaign subject migration', () => {
  it('sets bounded rollout timeouts before schema work', () => {
    expect(migration).toContain("SET lock_timeout = '10s'")
    expect(migration).toContain("SET statement_timeout = '5min'")
  })

  it('keeps source prospects separate from CRM leads', () => {
    expect(migration).toContain("subject_kind = 'prospect'")
    expect(migration).toContain('prospect_id uuid REFERENCES public.prospects')
    expect(migration).toContain('prospecting_campaign_members_subject_check')
    expect(migration).not.toMatch(/INSERT INTO public\.leads/)
    expect(acceptance).toContain('Campaign enrollment is never promotion')
  })

  it('snapshots every reviewed associated phone behind server-only access', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.prospecting_campaign_member_contacts')
    expect(migration).toContain('JOIN public.prospect_phones phone ON phone.prospect_id = selected.prospect_id')
    expect(migration).toContain('member_id, source_kind, prospect_id, prospect_phone_id, contact_key, phone_snapshot')
    expect(migration).toContain('prospect_id = EXCLUDED.prospect_id')
    expect(migration).toContain('SET prospect_id = phone.prospect_id')
    expect(migration).toContain('ALTER TABLE public.prospecting_campaign_member_contacts ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('selected_for_sms boolean NOT NULL DEFAULT false')
  })

  it('requires exact reviewed county filters and leaves enrollment inert', () => {
    expect(migration).toContain('county_audience_changed')
    expect(migration).toContain("campaign_row.status NOT IN ('draft', 'paused')")
    expect(migration).toContain("campaign_row.kind = 'dialer' THEN 'active'")
    expect(migration).toContain("ELSE 'needs_review'")
    expect(migration).not.toContain('safeSendSMS')
    expect(migration).not.toContain('<Dial>')
  })

  it('stops unlinked prospect work by canonical inbound phone identity', () => {
    expect(migration).toContain('inbound_phone_key')
    expect(migration).toContain('public.prospecting_campaign_member_contacts contact')
    expect(migration).toContain("error_code = 'contact_replied'")
    expect(migration).toContain('stop_phone_key')
    expect(migration).toContain("error_code = 'sms_opt_out'")
  })

  it('preserves legacy Lead campaigns through additive subject contracts', () => {
    expect(migration).toContain("SET subject_kind = 'lead', prospect_id = NULL")
    expect(migration).toContain("'lead_primary'")
    expect(migration).toContain('selected_for_sms, enrolled_at')
    expect(acceptance).toContain('Existing Lead-only campaigns and dialer sessions remain valid')
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.prospecting_campaign_member_page_v3')
  })
})
