import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = new URL('../../../supabase/migrations/20260823120000_crm_entity_foundation.sql', import.meta.url)
const migration = readFileSync(migrationPath, 'utf8')

describe('CRM entity foundation migration', () => {
  it('is additive and does not repurpose legacy entity tables', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.crm_people')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.crm_contact_methods')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.crm_properties')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.crm_opportunities')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.crm_lead_entity_links')
    expect(migration).not.toMatch(/DROP TABLE/i)
    expect(migration).not.toMatch(/ALTER TABLE public\.(contacts|properties|deals)\b/i)
  })

  it('keeps browser roles away from canonical PII and grants server reads only', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.refresh_crm_entity_for_lead_core(uuid) FROM PUBLIC, anon, authenticated, service_role')
  })

  it('deduplicates contact methods and properties while preserving ambiguous identity evidence', () => {
    expect(migration).toContain('UNIQUE (method_type, normalized_value)')
    expect(migration).toContain('normalized_address text NOT NULL UNIQUE')
    expect(migration).toContain('phone_email_disagree')
    expect(migration).toContain('method_claimed_elsewhere')
    expect(migration).toContain('crm_identity_conflicts')
  })

  it('projects current and future lead writes without changing the compatibility source', () => {
    expect(migration).toContain('LOCK TABLE public.leads IN SHARE ROW EXCLUSIVE MODE')
    expect(migration).toContain('PERFORM public.refresh_crm_entity_for_lead_core(lead_record.id)')
    expect(migration).toContain('CREATE TRIGGER trigger_refresh_crm_entity_for_lead')
    expect(migration).toContain('AFTER INSERT OR UPDATE OF full_name, phone, email, property_address')
  })

  it('carries STOP and START provenance into a durable consent ledger', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.crm_consent_events')
    expect(migration).toContain('CREATE TRIGGER trigger_sync_crm_sms_consent')
    expect(migration).toContain("CASE WHEN NEW.is_opted_out THEN 'opted_out' ELSE 'opted_in' END")
    expect(migration).toContain('ON CONFLICT (idempotency_key) DO NOTHING')
  })
})
