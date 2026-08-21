import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260828120000_ai_change_proposal_governance.sql'),
  'utf8',
)

describe('AI change proposal governance migration', () => {
  it('creates a service-role-only proposal and decision ledger', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.ai_change_proposals')
    expect(migration).toContain("status IN ('proposed', 'applied', 'rejected', 'conflict')")
    expect(migration).toContain("source_type IN ('call_analysis')")
    expect(migration).toContain('REVOKE ALL ON TABLE public.ai_change_proposals FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('GRANT ALL ON TABLE public.ai_change_proposals TO service_role')
    expect(migration).toContain('idx_ai_change_proposals_entity_pending')
  })

  it('allows only the five reviewed lead fields and performs optimistic conflict detection', () => {
    for (const field of ['motivation_score', 'property_condition', 'asking_price', 'opportunity_score', 'classification']) {
      expect(migration).toContain(`'${field}'`)
    }
    expect(migration).toContain('lead_changed_since_proposal')
    expect(migration).toContain('IS DISTINCT FROM (target.base_snapshot -> field_name)')
  })

  it('applies manifest and lead changes with one idempotent audited database decision', () => {
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain('public.update_manifest_and_cascade')
    expect(migration).toContain('AI-proposed CRM changes reviewed and applied')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.decide_ai_change_proposal_v1')
  })
})
