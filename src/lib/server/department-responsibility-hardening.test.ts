import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261008120000_department_responsibility_hardening.sql',
  'utf8',
)
const acceptanceMigration = readFileSync(
  'supabase/migrations/20260916120000_handoff_acceptance_verified_fallout.sql',
  'utf8',
)

describe('department responsibility hardening', () => {
  it('keeps Marketing as attribution while Acquisitions owns new sellers', () => {
    expect(migration).toContain("WHEN 'new' THEN 'acquisitions'")
    expect(migration).toContain("WHEN 'contacted' THEN 'acquisitions'")
    expect(migration).toContain("WHEN 'under_contract' THEN 'dispositions'")
    expect(migration).toContain("WHEN 'closing' THEN 'transaction_coordination'")
    expect(migration).not.toContain("WHEN 'new' THEN 'marketing'")
  })

  it('requires the receiving department to accept new evidence-backed handoffs', () => {
    expect(migration).toContain("'pending', lead_row.assigned_agent")
    expect(migration).not.toContain("'accepted', lead_row.assigned_agent")
    expect(migration).not.toContain('accepted_at')
    expect(acceptanceMigration).toContain('crm_accept_department_handoff_v1')
  })
})
