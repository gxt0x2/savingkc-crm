import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260923120000_contact_workspace_manifest_retirement.sql',
  'utf8',
)

describe('Manifest-free Pipeline directory migration', () => {
  it('reads the bounded Pipeline from canonical entities and compact projections', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.contact_workspace_page_v3')
    expect(migration).toContain('public.crm_lead_entity_links')
    expect(migration).toContain('public.crm_people')
    expect(migration).toContain('public.crm_contact_methods')
    expect(migration).toContain('public.crm_properties')
    expect(migration).toContain('public.crm_opportunities')
    expect(migration).toContain('public.conversation_thread_state')
    expect(migration).toContain('public.contact_workspace_activity_state')
    expect(migration).toContain('LIMIT capped_limit + 1')
  })

  it('does not read or promote legacy Manifest recommendations and tags', () => {
    expect(migration).not.toContain('public.manifests')
    expect(migration).not.toContain('latest_manifest')
    expect(migration).not.toContain('manifest_tags')
    expect(migration).not.toContain('btrim(tag_filter)')
    expect(migration).toContain('ARRAY[]::TEXT[];')
  })

  it('keeps v2 available for rollback and restricts v3 to the service role', () => {
    expect(migration).not.toContain('DROP FUNCTION public.contact_workspace_page_v2')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
  })
})
