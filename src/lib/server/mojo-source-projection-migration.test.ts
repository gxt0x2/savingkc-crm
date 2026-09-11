import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  'supabase/migrations/20261104120000_mojo_source_projection_v2.sql',
  'utf8',
)

describe('Mojo source projection v2 migration', () => {
  it('wraps the current governed ingestion chain instead of replacing it', () => {
    expect(migration).toContain('RENAME TO ingest_crm_mojo_call_governed_v1')
    expect(migration).toContain('governed_result := public.ingest_crm_mojo_call_governed_v1')
    expect(migration).toContain("governed_result || jsonb_build_object('sourceProjection', projection_result)")
  })

  it('protects canonical property identity before filling a coherent location', () => {
    expect(migration).toContain("location_reason := 'canonical_property_link_differs'")
    expect(migration).toContain("location_reason := 'lead_address_differs'")
    expect(migration).toContain('property_location IS DISTINCT FROM source_location')
    expect(migration).toContain("'bundle', 'property_location'")
  })

  it('has an idempotent repair operation and policy-aware receipts', () => {
    expect(migration).toContain('repair_crm_mojo_event_projection_v2')
    expect(migration).toContain('PRIMARY KEY (event_id, field_name)')
    expect(migration).toContain("'protected_conflict'")
    expect(migration).toContain("'unresolved_identity'")
  })

  it('preserves alternate emails and records ownership conflicts', () => {
    expect(migration).toContain('provider_emails text[]')
    expect(migration).toContain("'email:' || normalized_email")
    expect(migration).toContain("'method_claimed_elsewhere'")
  })
})
