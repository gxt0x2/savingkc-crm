import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261004120000_contact_workspace_canonical_opportunity_score.sql',
  'utf8',
)
const readModel = readFileSync('src/lib/server/contact-directory-read-model.ts', 'utf8')

describe('canonical Pipeline opportunity score', () => {
  it('reads, filters, sorts, and cursors from the canonical lead score', () => {
    expect(migration).toContain('public.contact_workspace_page_v4(')
    expect(migration).toContain('COALESCE(lead.opportunity_score, 0)::INTEGER AS score')
    expect(migration).not.toContain('hot_opportunities_cache')
    expect(migration).not.toContain('score.composite_score')
  })

  it('keeps the bounded, service-only contact contract', () => {
    expect(migration).toContain('LIMIT capped_limit + 1')
    expect(migration).toContain('LIMIT capped_limit')
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.contact_workspace_page_v4[\s\S]+FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.contact_workspace_page_v4[\s\S]+TO service_role/)
    expect(readModel).toContain("db.rpc('contact_workspace_page_v4'")
  })
})
