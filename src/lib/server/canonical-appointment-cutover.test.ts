import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('canonical appointment cutover contract', () => {
  it('keeps public booking atomic, durable, and independent of Manifest', () => {
    const route = source('src/app/api/book/route.ts')
    expect(route).toContain('createCanonicalBooking')
    expect(route).toContain('buildQueuedSmsMetadata')
    expect(route).not.toContain('ensureManifestExists')
    expect(route).not.toContain('updateManifestAndCascade')
    expect(route).not.toContain('safeSendSMS')
    expect(route).not.toContain('setTimeout')
  })

  it('records webhook bookings and reviewed outcomes on canonical appointments', () => {
    const ppc = source('src/app/api/leads/ppc/book/route.ts')
    const outcome = source('src/app/api/leads/appointment-outcome/route.ts')
    expect(ppc).toContain('upsertAppointmentFromCall')
    expect(ppc).not.toContain('updateManifestAndCascade')
    expect(ppc).not.toContain('randomUUID')
    expect(outcome).toContain('resolveAuthenticatedActor')
    expect(outcome).toContain(".from('appointments')")
    expect(outcome).not.toContain('updateManifestV2_1')
    expect(outcome).not.toContain("agent: 'Casey'")
  })

  it('does not fabricate an appointment from a disposition', () => {
    const dispositionRoute = source('src/app/api/leads/[id]/disposition/route.ts')
    const dispositionCommand = source('src/lib/server/lead-disposition-command.ts')
    expect(dispositionRoute).toContain('buildLeadDispositionCommand')
    expect(dispositionCommand).toContain("code: 'appointment_details_required'")
    expect(dispositionCommand).not.toContain("scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000)")
  })

  it('archives the unscheduled heuristic ghost automation and removes its executable files', () => {
    const catalog = source('src/lib/operating-model/workflow-catalog.ts')
    expect(catalog).toMatch(/id: 'appointment-ghost-protocol'[\s\S]*status: 'archived', health: 'not_run'/)
    expect(existsSync(resolve(root, 'src/app/api/workers/appointment-reminder/route.ts'))).toBe(false)
    expect(existsSync(resolve(root, 'src/lib/ghost-protocol-appointment.ts'))).toBe(false)
    expect(existsSync(resolve(root, 'src/lib/ghost-risk-calculator.ts'))).toBe(false)
  })

  it('ships a service-only booking RPC with slot and privacy invariants', () => {
    const migration = source('supabase/migrations/20260930110000_canonical_bookings_and_appointments.sql')
    expect(migration).toContain('idx_bookings_confirmed_slot_unique')
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS appointment_id')
    expect(migration).toContain('REVOKE ALL ON TABLE public.bookings FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.create_canonical_booking_v1')
  })
})
