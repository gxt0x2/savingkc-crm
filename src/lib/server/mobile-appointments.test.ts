import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  lifecycle: vi.fn(),
  conversion: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ rpc: mocks.rpc }),
}))
vi.mock('@/lib/pipeline-auto-advance', () => ({ checkAutoAdvance: mocks.lifecycle }))
vi.mock('@/lib/ppc/appointment-booked-conversion', () => ({
  queuePpcAppointmentBookedConversion: mocks.conversion,
}))

import { executeMobileAppointmentCommand } from './mobile-appointments'

const appointment = {
  id: '11111111-1111-4111-8111-111111111111',
  lead_id: '22222222-2222-4222-8222-222222222222',
  type: 'in_person',
  status: 'scheduled',
  scheduled_at: '2026-10-01T15:00:00.000Z',
  ends_at: '2026-10-01T16:00:00.000Z',
  title: 'Seller visit',
  location: '2808 W 49th St',
  address: '2808 W 49th St',
  time_zone: 'America/Chicago',
  assigned_to: 'Ernest',
  notes: 'Bring comps',
  sequence_enabled: false,
  version: 1,
  source: 'manual',
  created_at: '2026-09-18T12:00:00.000Z',
  updated_at: '2026-09-18T12:00:00.000Z',
  provider_event_id: null,
  provider_sync_status: 'not_configured',
  provider_synced_at: null,
  provider_sync_error: null,
}

const command = {
  actor: { email: 'ernest@savingkc.com', name: 'Ernest' },
  idempotencyKey: 'appointment-create-1',
  command: 'create' as const,
  leadId: appointment.lead_id,
  payload: {
    leadId: appointment.lead_id,
    type: appointment.type,
    scheduledAt: appointment.scheduled_at,
    endsAt: appointment.ends_at,
    title: appointment.title,
    location: appointment.location,
    timeZone: appointment.time_zone,
    assignedTo: appointment.assigned_to,
    notes: appointment.notes,
    sendReminder: false,
  },
}

describe('mobile appointment side-effect idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.lifecycle.mockResolvedValue({ advanced: true })
    mocks.conversion.mockResolvedValue({ queued: true, reason: 'queued' })
  })

  it('does not repeat lifecycle or attribution work for an exact command replay', async () => {
    mocks.rpc.mockResolvedValue({
      data: { created: false, changed: false, replayed: true, appointment, activityId: 'activity-1' },
      error: null,
    })

    const result = await executeMobileAppointmentCommand(command)

    expect(result).toMatchObject({
      created: false,
      changed: false,
      replayed: true,
      sideEffects: { lifecycle: 'not_applicable', conversion: 'not_applicable' },
    })
    expect(mocks.lifecycle).not.toHaveBeenCalled()
    expect(mocks.conversion).not.toHaveBeenCalled()
  })

  it('runs lifecycle and attribution work after the first successful create', async () => {
    mocks.rpc.mockResolvedValue({
      data: { created: true, changed: true, replayed: false, appointment, activityId: 'activity-1' },
      error: null,
    })

    const result = await executeMobileAppointmentCommand(command)

    expect(result.sideEffects).toMatchObject({ lifecycle: 'advanced', conversion: 'queued' })
    expect(mocks.lifecycle).toHaveBeenCalledOnce()
    expect(mocks.conversion).toHaveBeenCalledOnce()
  })
})
