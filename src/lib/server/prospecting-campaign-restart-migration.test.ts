import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261122130000_restart_tax_dialer_campaigns.sql',
  'utf8',
)

describe('prospecting campaign partial-run restart migration', () => {
  it('restarts active or completed dialer campaigns without reopening blocked phones', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.rerun_prospecting_dialer_campaign_v2')
    expect(migration).toContain("campaign_row.status NOT IN ('active', 'completed')")
    expect(migration).toContain("member.status IN ('active', 'completed')")
    expect(migration).toContain("contact.status = 'ready'")
    expect(migration).toContain('FROM public.sms_opt_outs opt_out')
    expect(migration).toContain('FROM public.prospect_phones phone')
    expect(migration).toContain('FROM public.dialer_session_attempts prior_attempt')
    expect(migration).toContain("'dnc', 'do_not_call', 'wrong_number', 'disconnected', 'bad_number'")
  })

  it('refuses to reset around open sessions or unfinished calls and preserves history', () => {
    expect(migration).toContain("session.status IN ('active', 'paused')")
    expect(migration).toContain("attempt.status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition')")
    expect(migration).toContain("SET status = 'active', dialer_session_id = NULL, completed_at = NULL")
    expect(migration).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP TABLE)\b/)
    expect(migration).not.toContain('UPDATE public.dialer_session_attempts')
  })

  it('resets both requested Tax 3+ campaign ids as one fail-closed migration', () => {
    expect(migration).toContain("'eac5fbe3-47f5-4ef9-a91a-ef6e222923d6'::uuid")
    expect(migration).toContain("'74609ed4-7e26-4111-b626-b2e3f68efa0b'::uuid")
    expect(migration).toContain("'ernest@savingkc.com'")
    expect(migration).toContain('PERFORM public.rerun_prospecting_dialer_campaign_v2(')
  })

  it('keeps the restart command server-only', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.rerun_prospecting_dialer_campaign_v2[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.rerun_prospecting_dialer_campaign_v2[\s\S]*TO service_role/)
  })
})
