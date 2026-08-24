import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260929120000_canonical_ai_briefings.sql', 'utf8')
const askingPriceMigration = readFileSync('supabase/migrations/20260929110000_canonical_lead_asking_price.sql', 'utf8')

describe('canonical AI briefing migration', () => {
  it('establishes the canonical seller asking-price field before briefing triggers use it', () => {
    expect(askingPriceMigration).toContain('ADD COLUMN IF NOT EXISTS asking_price numeric')
    expect(askingPriceMigration).toContain('asking_price >= 0')
    expect(askingPriceMigration).toContain('never written autonomously')
    expect(migration).toContain('property_condition, asking_price')
  })

  it('publishes one current briefing backed by a completed governed generation', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS generation_id uuid REFERENCES public.assistant_generations')
    expect(migration).toContain('idx_briefings_one_current_per_lead')
    expect(migration).toContain("WHERE id = p_generation_id AND status = 'complete'")
    expect(migration).toContain("hashtextextended('crm-briefing:' || p_lead_id::text, 0)")
    expect(migration).toContain('UPDATE public.briefings\n  SET is_current = false')
  })

  it('coalesces CRM evidence changes behind bounded, revision-safe work', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.crm_briefing_jobs')
    expect(migration).toContain('revision = public.crm_briefing_jobs.revision + 1')
    expect(migration).toContain('FOR UPDATE SKIP LOCKED')
    expect(migration).toContain('least(coalesce(p_limit, 3), 5)')
    expect(migration).toContain('IF job.revision <> p_revision THEN')
    expect(migration).toContain("next_status := 'pending'")
  })

  it('keeps triggers provider-free and commands service-only', () => {
    expect(migration).toContain('trigger_queue_briefing_from_activity')
    expect(migration).toContain('trigger_queue_briefing_from_property')
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.crm_briefing_jobs FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_crm_briefing_jobs_v1\(integer\)[\s\S]+TO service_role/)
    expect(migration).not.toMatch(/\bmanifests?\b/i)
    expect(migration).not.toMatch(/groq|openai|gateway|fetch\s*\(/i)
  })
})
