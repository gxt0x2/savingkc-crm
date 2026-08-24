import fs from 'fs'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  'supabase/migrations/20261001120000_canonical_mojo_call_ingestion.sql',
  'utf8',
)

describe('canonical Mojo call ingestion migration', () => {
  it('creates a private immutable provider-call ledger', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.crm_mojo_call_events')
    expect(migration).toContain('record_id text NOT NULL UNIQUE')
    expect(migration).toContain('ALTER TABLE public.crm_mojo_call_events ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL ON TABLE public.crm_mojo_call_events FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crm_mojo_call_events TO service_role')
  })

  it('uses atomic service-only queue claims and completions', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.claim_mojo_call_queue_v1')
    expect(migration).toContain('FOR UPDATE SKIP LOCKED')
    expect(migration).toContain("status = 'processing'")
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.finish_mojo_call_queue_v1')
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.claim_mojo_call_queue_v1[\s\S]+FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.finish_mojo_call_queue_v1[\s\S]+TO service_role/)
  })

  it('deduplicates ingestion and records typed factual call evidence', () => {
    const ingest = migration.split('CREATE OR REPLACE FUNCTION public.ingest_crm_mojo_call_v1')[1] || ''
    expect(migration).toContain("pg_catalog.hashtextextended('canonical-mojo-call:' || record_value, 0)")
    expect(migration).toContain("'source', 'mojo_call_event'")
    expect(migration).toContain("'direction', 'outbound'")
    expect(migration).toContain("'phone_status', CASE")
    expect(migration).toContain('JOIN public.prospects AS prospect ON prospect.id = prospect_phone.prospect_id')
    expect(migration).toContain('idx_prospect_phones_canonical_phone')
    expect(migration).toContain("'call_source', 'crm_mojo_call_events'")
    expect(migration).toContain('ON CONFLICT (agent_id, date) DO UPDATE SET')
    expect(ingest).not.toContain('opportunity_score =')
    expect(ingest).not.toContain('classification =')
  })
})
