import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(new URL('../../../supabase/migrations/20260916120000_handoff_acceptance_verified_fallout.sql', import.meta.url), 'utf8')

describe('handoff acceptance and verified fallout migration', () => {
  it('accepts only pending handoffs and records the verified actor', () => {
    expect(sql).toContain('crm_accept_department_handoff_v1')
    expect(sql).toContain("handoff_row.status <> 'pending'")
    expect(sql).toContain("status = 'accepted'")
    expect(sql).toContain('accepted_by = trim(target_actor_name)')
  })

  it('requires evidence before a fallout can close every operating record', () => {
    expect(sql).toContain('crm_finalize_verified_fallout_v1')
    expect(sql).toContain('fallout_evidence_required')
    expect(sql).toContain("'closed_lost', 'dead'")
    expect(sql).toContain("status = 'cancelled'")
    expect(sql).toContain("'fell_through', 0")
    expect(sql).toContain('UPDATE public.deal_pages SET is_active = false')
  })

  it('preserves current lead priority during funded close instead of promoting every close to hot', () => {
    expect(sql).toContain("coalesce(lead_row.priority, 'normal')")
    expect(sql).not.toContain("'closed_won', 'opportunity', 'hot'")
  })

  it('keeps all new commands service-role only', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.crm_accept_department_handoff_v1')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.crm_finalize_verified_fallout_v1')
    expect(sql).toContain('TO service_role')
  })
})
