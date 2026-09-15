import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261109120000_mojo_appointment_reconciliation_provenance.sql', 'utf8')

describe('Mojo appointment reconciliation provenance', () => {
  it('requires appointment source or a canonical call link belonging to the same lead', () => {
    expect(migration).toContain("appointment.source = 'mojo_sync'")
    expect(migration).toContain('event.lead_id = appointment.lead_id')
    expect(migration).toContain('event.record_id = appointment.source_call_id')
    expect(migration).not.toContain('mojo_contact_id')
  })

  it('scopes every appointment failure and its sample without changing business records', () => {
    expect(migration).toContain("'deadActiveAppointments', (SELECT count(*) FROM dead_appointments)")
    expect(migration).toContain("'staleActiveAppointments', (SELECT count(*) FROM stale_appointments)")
    expect(migration).toContain("'cancelledOutcomeActiveAppointments', (SELECT count(*) FROM cancelled_appointments)")
    expect(migration).toContain('FROM stale_appointments ORDER BY scheduled_at, id LIMIT 10')
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE FROM|INSERT INTO)\s+public\./i)
  })

  it('retains the source integrity contract and existing service-only access', () => {
    expect(migration).toContain('crm_mojo_reconciliation_snapshot_base_v1(p_since)')
    expect(migration).toContain("WHERE e.qualification_status = 'evidence_pending'")
    expect(migration).toContain("WHERE q.status = 'waiting_evidence'")
    expect(migration).toContain("'sourceBatchesUnaccepted'")
    expect(migration).toContain("'queueOverdue'")
    expect(migration).toContain("'unlinkedFutureFollowups'")
    expect(migration).toContain("'strongDuplicateRecordingPairs'")
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
  })
})
