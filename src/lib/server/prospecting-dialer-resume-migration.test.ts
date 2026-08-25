import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261017120000_prospecting_dialer_resume_modes.sql', 'utf8')

describe('prospecting dialer resume modes migration', () => {
  it('keeps resume as the durable default and resumes a paused session', () => {
    expect(migration).toContain("p_start_behavior text DEFAULT 'resume'")
    expect(migration).toContain("IF start_behavior = 'resume' THEN")
    expect(migration).toMatch(/IF open_session\.status = 'paused'[\s\S]*SET status = 'active'/)
  })

  it('scopes an open session to the selected campaign', () => {
    expect(migration).toContain('open_session.prospecting_campaign_id IS DISTINCT FROM p_campaign_id')
    expect(migration).toContain("RAISE EXCEPTION 'another_dialer_session_open'")
  })

  it('rebuilds only from unfinished campaign members after checking for an open call', () => {
    expect(migration).toMatch(/status IN \('authorized', 'dialing', 'connected', 'awaiting_disposition'\)[\s\S]*RAISE EXCEPTION 'call_in_progress'/)
    expect(migration).toContain("SET status = 'stopped'")
    expect(migration).toContain("member.status = 'active'")
    expect(migration).toContain('member.dialer_session_id IS NULL')
    expect(migration).toContain('ORDER BY member.enrolled_at, member.id')
  })

  it('keeps the function service-role only', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v3')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
  })
})
