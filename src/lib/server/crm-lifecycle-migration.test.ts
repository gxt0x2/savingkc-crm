import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = new URL('../../../supabase/migrations/20260914120000_crm_lifecycle_commands.sql', import.meta.url)
const migration = readFileSync(migrationPath, 'utf8')

describe('CRM lifecycle command migration', () => {
  it('adds an immutable idempotent event ledger and explicit handoffs', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.crm_lifecycle_events')
    expect(migration).toContain('command_id uuid NOT NULL UNIQUE')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.crm_department_handoffs')
    expect(migration).toContain('IF from_department_value <> to_department_value THEN')
    expect(migration).not.toMatch(/DROP TABLE/i)
  })

  it('keeps browser roles away from lifecycle records and commands', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
    expect(migration).toContain('SECURITY DEFINER')
  })

  it('updates compatibility state and writes audit evidence in one transaction', () => {
    expect(migration).toContain('SELECT * INTO lead_row FROM public.leads WHERE id = target_lead_id FOR UPDATE')
    expect(migration).toContain('UPDATE public.leads SET')
    expect(migration).toContain('INSERT INTO public.crm_lifecycle_events')
    expect(migration).toContain('INSERT INTO public.lead_activities')
    expect(migration).toContain("'source', 'crm_lifecycle_command_v1'")
    expect(migration).toContain("target_evidence_type IS DISTINCT FROM 'seller_contract_signed'")
  })
})
