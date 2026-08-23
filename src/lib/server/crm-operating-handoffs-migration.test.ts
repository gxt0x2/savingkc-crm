import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(new URL('../../../supabase/migrations/20260915120000_seller_to_close_handoffs.sql', import.meta.url), 'utf8')
const dispoRoute = readFileSync(new URL('../../app/api/dispo-deals/route.ts', import.meta.url), 'utf8')

describe('seller-to-close handoff migration', () => {
  it('materializes one Dispositions deal from a governed seller handoff', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.dispo_deals')
    expect(sql).toContain('idx_dispo_deals_one_per_lead')
    expect(sql).toContain('CREATE TRIGGER trigger_crm_materialize_dispositions_handoff')
    expect(sql).toContain("VALUES (NEW.lead_id, 'new', 'Created from signed seller-contract handoff')")
  })

  it('owns closeout schema in a migration instead of runtime route DDL', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS closeout_status')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS debrief_due_at')
    expect(dispoRoute).not.toContain("rpc('exec_sql'")
    expect(dispoRoute).not.toContain('ensureTable()')
  })

  it('creates an idempotent assignment-to-TC handoff boundary', () => {
    expect(sql).toContain('crm_record_department_handoff_v1')
    expect(sql).toContain('idx_crm_department_handoffs_source')
    expect(sql).toContain("'accepted'")
  })

  it('stores only verified Marketing outcomes and revenue evidence', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.crm_marketing_outcomes')
    expect(sql).toContain("CHECK (outcome IN ('closed_won', 'fell_through'))")
    expect(sql).toContain("target_evidence_type NOT IN ('funded_closeout', 'verified_fallout')")
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('crm_finalize_funded_close_v1')
    expect(sql).toContain("'funded:' || target_deal_id::text")
  })
})
