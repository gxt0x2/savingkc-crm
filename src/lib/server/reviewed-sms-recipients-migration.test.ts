import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261006130000_reviewed_sms_recipients.sql',
  'utf8',
)

describe('reviewed SMS recipients migration', () => {
  it('allows at most one ready reviewed recipient per member', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_prospecting_campaign_member_contacts_sms')
    expect(migration).toContain("WHERE status = 'ready' AND selected_for_sms = true")
    expect(migration).toContain('campaign_contact_not_eligible')
    expect(migration).toContain('SET selected_for_sms = (id = p_contact_id)')
  })

  it('keeps review inert until separately activated', () => {
    const reviewStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.review_prospecting_campaign_sms_recipient_v1')
    const activationStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.activate_prospecting_campaign_v1')
    const review = migration.slice(reviewStart, activationStart)
    expect(review).toContain("campaign_row.status NOT IN ('draft', 'paused')")
    expect(review).toContain("status = 'active'")
    expect(review).not.toContain('safeSendSMS')
    expect(review).not.toContain('INSERT INTO public.prospecting_campaign_actions')
  })

  it('creates subject-aware actions only from the reviewed contact', () => {
    expect(migration).toContain('contact.status = \'ready\' AND contact.selected_for_sms = true')
    expect(migration).toContain('campaign_id, member_id, step_id, lead_id, prospect_id, prospect_phone_id, scheduled_at')
    expect(migration).toContain("'subjectKind', member.subject_kind")
    expect(migration).toContain("'prospectId', action_row.prospect_id")
    expect(migration).toContain("'prospectPhoneId', action_row.prospect_phone_id")
  })

  it('preserves subject identity for every later sequence step', () => {
    expect(migration).toContain('action_row.lead_id, action_row.prospect_id, action_row.prospect_phone_id')
    expect(migration).toContain("error_code = 'recipient_review_required'")
    expect(migration).toContain("error_code = 'recipient_changed'")
  })
})
