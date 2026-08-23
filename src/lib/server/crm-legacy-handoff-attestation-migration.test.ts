import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(new URL('../../../supabase/migrations/20260917120000_legacy_handoff_attestation.sql', import.meta.url), 'utf8')

describe('legacy handoff attestation migration', () => {
  it('requires evidence, date, verified actor, and linked source records', () => {
    expect(sql).toContain('crm_attest_legacy_handoff_v1')
    expect(sql).toContain('legacy_handoff_evidence_required')
    expect(sql).toContain('invalid_legacy_handoff_evidence_date')
    expect(sql).toContain('actor_required')
    expect(sql).toContain("target_kind NOT IN ('seller_handoff', 'assignment_handoff')")
    expect(sql).toContain('legacy_dispo_deal_not_found')
    expect(sql).toContain('legacy_buyer_offer_not_found')
    expect(sql).toContain('tc_file_offer_mismatch')
  })

  it('keeps the command service-role-only and records an actor-attributed audit activity', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.crm_attest_legacy_handoff_v1')
    expect(sql).toContain('FROM PUBLIC, anon, authenticated')
    expect(sql).toContain('TO service_role')
    expect(sql).toContain("'source', 'crm_legacy_handoff_attestation_v1'")
    expect(sql).toContain("'actor_email', lower(trim(target_actor_email))")
  })
})
