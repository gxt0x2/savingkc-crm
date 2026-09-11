import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  'supabase/migrations/20261030123000_mojo_seller_intent_vocabulary.sql',
  'utf8',
)

describe('Mojo seller-intent vocabulary migration', () => {
  it('patches the database guard with the same natural seller wording as the app', () => {
    expect(migration).toContain('plans? to sell|planning to sell|willing to sell|getting rid of|ready to part with')
    expect(migration).toContain('pg_catalog.pg_get_functiondef')
    expect(migration).toContain('pg_catalog.replace')
    expect(migration).toContain('mojo_qualification_v1_1')
  })

  it('reclassifies only complete evidence that previously missed seller intent', () => {
    expect(migration).toContain("event.qualification_reasons = ARRAY['missing_seller_intent_evidence']::text[]")
    expect(migration).toContain('event.duration_seconds >= 120')
    expect(migration).toContain('event.recording_url IS NOT NULL')
    expect(migration).toContain("qualification_status = 'eligible'")
    expect(migration).toContain("qualification_reasons = ARRAY['seller_intent_documented', 'minimum_duration_met']::text[]")
  })

  it('preserves the lead and lifecycle boundaries', () => {
    expect(migration).not.toMatch(/UPDATE\s+public\.leads/i)
    expect(migration).not.toMatch(/INSERT\s+INTO\s+public\.leads/i)
    expect(migration).not.toMatch(/crm_lifecycle_events/i)
    expect(migration).not.toMatch(/mojo_call_queue/i)
  })
})
