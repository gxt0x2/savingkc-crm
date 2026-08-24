import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261005120000_retire_manifest_runtime_writers.sql',
  'utf8',
)
const canonicalDecisionMigration = readFileSync(
  'supabase/migrations/20261002120000_ai_change_proposal_manifest_retirement.sql',
  'utf8',
)

describe('Manifest database-writer retirement migration', () => {
  it('removes automatic creation, cascade, and RPC write paths', () => {
    expect(migration).toContain('DROP TRIGGER IF EXISTS trg_auto_create_manifest ON public.leads')
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.auto_create_manifest_for_lead()')
    expect(migration).toContain('DROP TRIGGER IF EXISTS trg_manifest_cascade_to_lead ON public.manifests')
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.sync_manifest_to_lead()')
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.update_manifest_and_cascade(uuid, jsonb, text, text)')
    expect(migration).toMatch(/REVOKE INSERT, UPDATE ON TABLE public\.manifests\s+FROM PUBLIC, anon, authenticated, service_role/)
  })

  it('preserves the canonical AI decision contract without a Manifest mirror', () => {
    expect(canonicalDecisionMigration).toContain('CREATE OR REPLACE FUNCTION public.decide_ai_change_proposal_v1')
    expect(canonicalDecisionMigration).toContain('UPDATE public.leads SET')
    expect(canonicalDecisionMigration).toContain("'AI-proposed CRM changes reviewed and applied'")
    expect(canonicalDecisionMigration).not.toContain('public.manifests')
    expect(canonicalDecisionMigration).not.toContain('update_manifest_and_cascade')
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.decide_ai_change_proposal_v1')
  })

  it('is lock-bounded and preserves historical rows', () => {
    expect(migration).toContain("SET LOCAL lock_timeout = '5s'")
    expect(migration).toContain("SET LOCAL statement_timeout = '30s'")
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM public\.manifests|TRUNCATE/)
    expect(migration).toContain('Historical Manifest JSON retained read-only')
  })
})
