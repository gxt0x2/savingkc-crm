import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261015120000_crm_profile_update_command.sql',
  'utf8',
)

describe('canonical contact profile update command', () => {
  it('keeps the compatibility write and canonical postcondition in one transaction', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.crm_update_lead_profile_v1')
    expect(migration).toContain('UPDATE public.leads SET')
    expect(migration).toContain('canonical_profile_conflict:full_name')
    expect(migration).toContain('canonical_profile_conflict:phone')
    expect(migration).toContain('canonical_profile_conflict:property_address')
    expect(migration).toContain('canonical_profile_conflict:source')
    expect(migration).toContain("target_patch ?| ARRAY['property_address', 'city', 'state', 'zip', 'county']")
    expect(migration).toContain("person_id = NULL")
    expect(migration).toContain("invalid_profile_field:full_name")
  })

  it('allowlists profile fields and records a non-PII activity audit', () => {
    expect(migration).toContain("'full_name', 'phone', 'email', 'property_address', 'city', 'state'")
    expect(migration).toContain("'zip', 'county', 'source', 'notes', 'offer_amount'")
    expect(migration).toContain("'profile_update'")
    expect(migration).toContain("'changed_fields', to_jsonb(changed_fields)")
    expect(migration).not.toContain("'old_value'")
    expect(migration).not.toContain("'new_value'")
  })

  it('is executable only by the service role', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.crm_update_lead_profile_v1[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.crm_update_lead_profile_v1[\s\S]*TO service_role/)
  })
})
