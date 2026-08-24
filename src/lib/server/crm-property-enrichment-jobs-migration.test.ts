import fs from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = fs.readFileSync('supabase/migrations/20260928120000_crm_property_enrichment_jobs.sql', 'utf8')

describe('canonical property enrichment job migration', () => {
  it('queues every eligible lead intake path behind one durable trigger', () => {
    expect(source).toContain('CREATE TABLE IF NOT EXISTS public.crm_property_enrichment_jobs')
    expect(source).toContain('CREATE TRIGGER trigger_queue_crm_property_enrichment')
    expect(source).toContain('AFTER INSERT OR UPDATE OF phone, property_address')
    expect(source).toContain('revision = public.crm_property_enrichment_jobs.revision + 1')
    expect(source).toContain('attempts = 0')
    expect(source).not.toMatch(/\bmanifests?\b/i)
  })

  it('claims bounded work with lease recovery and private service-only commands', () => {
    expect(source).toContain('FOR UPDATE SKIP LOCKED')
    expect(source).toContain("claimed_at < now() - interval '15 minutes'")
    expect(source).toContain('least(coalesce(p_limit, 3), 5)')
    expect(source).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(source).toMatch(/REVOKE ALL ON FUNCTION public\.claim_crm_property_enrichment_jobs_v1[\s\S]+FROM PUBLIC, anon, authenticated/)
    expect(source).toMatch(/GRANT EXECUTE ON FUNCTION public\.finish_crm_property_enrichment_job_v1[\s\S]+TO service_role/)
  })
})
