import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260918170000_mobile_appointment_commands.sql'),
  'utf8',
)

describe('mobile appointment command migration', () => {
  it('stores every editor field and a durable concurrency version', () => {
    for (const field of ['title', 'ends_at', 'location', 'time_zone', 'version', 'provider_sync_status']) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${field}`)
    }
    expect(migration).toContain('appointments_mobile_duration_check')
    expect(migration).toContain("scheduled_at + interval '15 minutes'")
    expect(migration).toContain('appointments_mobile_version_check')
  })

  it('serializes actor-scoped retry keys and rejects conflicting reuse', () => {
    expect(migration).toContain('PRIMARY KEY (actor_email, idempotency_key)')
    expect(migration).toContain("pg_catalog.hashtextextended('mobile-appointment:'")
    expect(migration).toContain('appointment_idempotency_conflict')
    expect(migration).toContain('payload_hash IS DISTINCT FROM p_payload_hash')
  })

  it('uses expected versions and preserves appointment identity on changes', () => {
    expect(migration).toContain('appointment_version_conflict')
    expect(migration).toContain('WHERE id = current_appointment.id')
    expect(migration).toContain('version = current_appointment.version + 1')
    expect(migration).not.toContain("interval '60 minutes'")
  })

  it('keeps command data service-role only', () => {
    expect(migration).toContain('ALTER TABLE public.appointment_command_events ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL ON TABLE public.appointment_command_events FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.apply_mobile_appointment_command_v1')
  })
})
