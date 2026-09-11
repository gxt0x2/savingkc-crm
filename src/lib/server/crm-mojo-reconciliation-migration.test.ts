import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261030133000_crm_mojo_reconciliation_health.sql',
  'utf8',
)

describe('CRM and Mojo reconciliation migration', () => {
  it('audits and normalizes only records already marked dead', () => {
    expect(migration).toContain("lower(coalesce(lead.station, '')) = 'dead'")
    expect(migration).toContain("lower(coalesce(lead.classification, '')) = 'dead'")
    expect(migration).toContain("'old_station', lead.station")
    expect(migration).toContain("'old_classification', lead.classification")
    expect(migration).toContain("dead_reason = coalesce(nullif(btrim(coalesce(lead.dead_reason, '')), ''), 'other')")
  })

  it('closes the reviewed historical appointments without clearing a different appointment snapshot', () => {
    expect(migration).toContain("'1fd03a44-4341-4f30-bcb2-3fc71c3beb30'::uuid, 'completed'::text")
    expect(migration).toContain("'2b025c81-1e85-49ff-97f1-d09f040eaa9e'::uuid, 'cancelled'::text")
    expect(migration).toContain('lead.appointment_date = appointment.scheduled_at')
    expect(migration).toContain("'reconciliation_key', '2026-09-09-appointment-v1:' || appointment.id::text")
  })

  it('exposes a bounded service-role-only reconciliation snapshot', () => {
    expect(migration).toContain('crm_mojo_reconciliation_snapshot_v1')
    expect(migration).toContain("now() - interval '90 days'")
    expect(migration).toContain("event.call_at < now() - interval '30 minutes'")
    expect(migration).toContain('work.primary_next_action = true')
    expect(migration).not.toContain("'deadMetadataIncomplete'")
    expect(migration).toContain('strong_duplicate_recording_pairs')
    expect(migration).toContain('abs(extract(epoch FROM second.call_at - first.call_at)) <= 3600')
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.crm_mojo_reconciliation_snapshot_v1[\s\S]+FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.crm_mojo_reconciliation_snapshot_v1[\s\S]+TO service_role/)
  })
})
