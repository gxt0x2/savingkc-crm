import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260925120000_crm_lead_qualification_pillars.sql', 'utf8')
const policy = readFileSync('src/lib/qualification-policy.ts', 'utf8')

describe('canonical lead qualification foundation', () => {
  it('stores four human-owned pillars and keeps legacy values review-only', () => {
    expect(migration).toContain("pillar IN ('TIMELINE', 'CONDITION', 'MOTIVATION', 'PRICE')")
    expect(migration).toContain("'needs_review'")
    expect(migration).toContain("'legacy_manifest'")
    expect(migration).toContain("status = 'verified'")
    expect(migration).toContain('Legacy hints never qualify a lead')
  })

  it('makes the atomic save boundary service-role-only', () => {
    expect(migration).toContain('save_crm_lead_qualification_v1')
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.save_crm_lead_qualification_v1[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.save_crm_lead_qualification_v1[\s\S]*TO service_role/)
    expect(migration).toContain("'canonical_qualification_v1'")
  })

  it('removes Manifest from the runtime qualification policy', () => {
    expect(policy).toContain("from('crm_lead_qualification_pillars')")
    expect(policy).not.toContain("from('manifests')")
    expect(policy).not.toContain('ManifestV2')
  })
})
