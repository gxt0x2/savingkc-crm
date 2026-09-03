import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261028120000_prospecting_call_reporting_and_reruns.sql',
  'utf8',
)

describe('prospecting call reporting and rerun migration', () => {
  it('stamps each new campaign session with a durable run number', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS dialer_run_number integer NOT NULL DEFAULT 1')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS campaign_run_number integer NOT NULL DEFAULT 1')
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF prospecting_campaign_id ON public.dialer_sessions')
    expect(migration).toContain('SELECT campaign.dialer_run_number')
  })

  it('reopens only completed members that still have a currently callable contact', () => {
    expect(migration).toContain("IF campaign_row.status <> 'completed' THEN RAISE EXCEPTION 'campaign_not_complete'")
    expect(migration).toMatch(/member\.status = 'completed'[\s\S]*contact\.status = 'ready'/)
    expect(migration).toContain("contact.source_kind = 'prospect_phone' AND contact.prospect_phone_id IS NULL")
    expect(migration).toContain('FROM public.sms_opt_outs opt_out')
    expect(migration).toContain('FROM public.prospect_phones phone')
    expect(migration).toContain('FROM public.dialer_session_attempts prior_attempt')
    expect(migration).toContain("'dnc', 'do_not_call', 'wrong_number', 'disconnected', 'bad_number'")
    expect(migration).toContain("SET status = 'active', dialer_session_id = NULL, completed_at = NULL")
    expect(migration).toContain("'campaign_rerun_started'")
  })

  it('blocks open sessions and unfinished attempts without erasing history', () => {
    expect(migration).toContain("session.status IN ('active', 'paused')")
    expect(migration).toContain("attempt.status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition')")
    expect(migration).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP TABLE)\b/)
    expect(migration).not.toContain('UPDATE public.dialer_session_attempts')
  })

  it('reports from campaign sessions and the durable attempt ledger', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.prospecting_campaign_call_report_v1')
    expect(migration).toContain('FROM public.dialer_session_attempts attempt')
    expect(migration).toContain('JOIN session_scope session ON session.id = attempt.session_id')
    expect(migration).toContain("'uniqueNumbers'")
    expect(migration).toContain("'outcomes'")
    expect(migration).toContain("'agents'")
    expect(migration).toContain("'sessions'")
  })

  it('keeps mutation and report functions server-only', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.rerun_prospecting_dialer_campaign_v1[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.prospecting_campaign_call_report_v1[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.rerun_prospecting_dialer_campaign_v1[\s\S]*TO service_role/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.prospecting_campaign_call_report_v1[\s\S]*TO service_role/)
  })
})
