import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261006123000_subject_aware_dialer_sessions.sql',
  'utf8',
)

describe('subject-aware durable dialer migration', () => {
  it('sets bounded rollout timeouts before schema work', () => {
    expect(migration).toContain("SET lock_timeout = '10s'")
    expect(migration).toContain("SET statement_timeout = '5min'")
  })

  it('adds canonical subject context without removing the legacy Lead queue', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS current_subject_kind text')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.start_dialer_session_v2')
    expect(migration).toContain("WHEN jsonb_typeof(p_snapshot -> p_index) = 'string'")
    expect(migration).toContain("'leadIds', CASE")
    expect(migration).toContain("'queueItems', public.dialer_session_queue_items_v2")
  })

  it('validates source subjects and campaign membership on the server', () => {
    expect(migration).toContain("coalesce(item ->> 'kind', '') NOT IN ('lead', 'prospect')")
    expect(migration).toContain('duplicate_queue_subject')
    expect(migration).toContain('invalid_campaign_member_subject')
    expect(migration).toContain('member.subject_kind = item ->> \'kind\'')
  })

  it('binds every authorized attempt to the current subject and source phone', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.authorize_dialer_attempt_v2')
    expect(migration).toContain('session_row.current_subject_id IS DISTINCT FROM p_subject_id')
    expect(migration).toContain('phone.id = p_prospect_phone_id')
    expect(migration).toContain("p_subject_kind = 'prospect' AND p_prospect_phone_id IS NULL")
    expect(migration).toContain('session_subject_mismatch')
  })

  it('starts campaign batches from members with at least one ready contact', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.start_prospecting_dialer_session_v2')
    expect(migration).toContain("contact.member_id = member.id AND contact.status = 'ready'")
    expect(migration).toContain("'campaignMemberId', candidate.id")
    expect(migration).toContain('LIMIT 100 FOR UPDATE')
  })

  it('projects completion by campaign member for both Leads and Prospects', () => {
    expect(migration).toContain("NEW.event_type NOT IN ('lead_completed', 'subject_completed')")
    expect(migration).toContain('NEW.campaign_member_id IS NOT NULL AND id = NEW.campaign_member_id')
    expect(migration).toContain("'subject_kind', member_row.subject_kind")
  })
})
