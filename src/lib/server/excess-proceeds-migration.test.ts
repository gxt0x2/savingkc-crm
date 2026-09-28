import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261120120000_jackson_excess_proceeds_lane.sql'),
  'utf8',
)

describe('Jackson excess-proceeds migration', () => {
  it('adds the lane on the Deal File and keys it by suit and parcel', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.crm_excess_proceeds')
    expect(migration).toContain('lead_id uuid NOT NULL UNIQUE REFERENCES public.leads(id)')
    expect(migration).toContain('idx_crm_excess_proceeds_suit_parcel')
    expect(migration).toContain("(suit_no, parcel_no)")
    expect(migration).toContain("track = 'excess_proceeds'")
    expect(migration).toContain("county_source = 'jackson_dlt'")
    expect(migration).toContain('surplus_fee_pct numeric(5, 2) NOT NULL DEFAULT 10')
    expect(migration).toContain("counsel_status IN ('pending', 'clear', 'blocked')")
    expect(migration).toContain("form_pack_status IN ('none', 'drafted', 'signed')")
    expect(migration).toContain("NEW.claim_deadline := (NEW.sale_date + interval '2 years')::date")
    expect(migration).toContain('crm_excess_proceeds_zestimate_pair')
    expect(migration).toContain('ALTER TABLE public.crm_excess_proceeds ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.crm_excess_proceeds TO service_role')
    expect(migration).toContain('source::text = %L')
    expect(migration).toContain("'excess_proceeds'")
  })

  it('lets Treasury post surplus recovery and fee income, then total the year', () => {
    expect(migration).toContain("'excess_proceeds_recovery'")
    expect(migration).toContain("'excess_proceeds_fee'")
    expect(migration).toContain('crm_deal_ledger_lines_category_check')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.crm_deal_ledger_ytd_v1')
    expect(migration).toContain("normalized_category NOT IN ('assignment_fee', 'transaction_fee', 'emd', 'overhead', 'other', 'excess_proceeds_recovery', 'excess_proceeds_fee')")
  })

  it('does not add Deal File stages or invent a skip trace', () => {
    expect(migration).not.toMatch(/ADD VALUE/i)
    expect(migration).not.toMatch(/skiptrace|smartskip/i)
    expect(migration).toContain('Does not move an existing station')
  })
})
