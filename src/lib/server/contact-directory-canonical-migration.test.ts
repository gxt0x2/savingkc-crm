import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260922120000_contact_workspace_canonical_overlay.sql',
  'utf8',
)

describe('canonical Pipeline directory migration', () => {
  it('keeps the page bounded while overlaying canonical entities', () => {
    expect(migration).toContain('public.contact_workspace_page_v1(')
    expect(migration).toContain('jsonb_array_elements(page.items)')
    expect(migration).toContain('public.crm_lead_entity_links')
    expect(migration).toContain('public.crm_people')
    expect(migration).toContain('public.crm_contact_methods')
    expect(migration).toContain('public.crm_properties')
    expect(migration).toContain('public.crm_opportunities')
    expect(migration).toContain("'entity_authority', 'canonical_entities'")
  })

  it('keeps the new RPC server-only and leaves V1 available for rollback', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.contact_workspace_page_v2')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
    expect(migration).not.toContain('DROP FUNCTION public.contact_workspace_page_v1')
  })
})
