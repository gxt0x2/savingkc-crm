import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  lifecycle: vi.fn(),
  conversion: vi.fn(),
  calendar: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ rpc: mocks.rpc, from: mocks.from }),
}))
vi.mock('@/lib/server/mobile-appointment-calendar', () => ({ syncMobileAppointmentCalendar: mocks.calendar }))
vi.mock('@/lib/pipeline-auto-advance', () => ({ checkAutoAdvance: mocks.lifecycle }))
vi.mock('@/lib/ppc/appointment-booked-conversion', () => ({
  queuePpcAppointmentBookedConversion: mocks.conversion,
}))

import { executeMobileAppointmentCommand, mapMobileAppointment } from './mobile-appointments'

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
    mocks.calendar.mockResolvedValue({ status: 'synced' })
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ data: {
      ...appointment, provider_event_id: `skc${appointment.id.replaceAll('-', '')}`,
      provider_sync_status: 'synced',
    }, error: null }) }) }) })
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
    expect(mocks.calendar).toHaveBeenCalledOnce()
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
    expect(result.appointment.sync.provider).toBe('synced')
  })

  it('does not roll back a saved command when Google sync fails', async () => {
    mocks.rpc.mockResolvedValue({
      data: { created: true, changed: true, replayed: false, appointment, activityId: 'activity-1' },
      error: null,
    })
    mocks.calendar.mockResolvedValue({ status: 'failed', warning: 'The appointment was saved, but Google Calendar was not updated.' })
    const result = await executeMobileAppointmentCommand(command)
    expect(result.success).toBe(true)
    expect(result.warning).toContain('Google Calendar was not updated')
  })

  it('keeps CRM cancellation successful when a legacy appointment has no calendar owner', async () => {
    const cancelled = { ...appointment, status: 'cancelled', version: 2, provider_sync_status: 'not_configured' }
    mocks.rpc.mockResolvedValue({
      data: { created: false, changed: true, replayed: false, appointment: cancelled, activityId: 'activity-cancelled' },
      error: null,
    })
    mocks.calendar.mockResolvedValue({ status: 'not_configured', warning: 'This appointment has no connected calendar owner.' })
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ data: cancelled, error: null }) }) }) })
    const result = await executeMobileAppointmentCommand({
      ...command, command: 'outcome', appointmentId: appointment.id, expectedVersion: 1,
      payload: { outcome: 'cancelled', notes: appointment.notes },
    })
    expect(result).toMatchObject({
      success: true, changed: true, appointment: { status: 'cancelled', version: 2 },
      sideEffects: { provider: 'not_configured', lifecycle: 'not_applicable', conversion: 'not_applicable' },
    })
    expect(result.warning).toContain('no connected calendar owner')
    expect(mocks.lifecycle).not.toHaveBeenCalled()
    expect(mocks.conversion).not.toHaveBeenCalled()
  })

  it('reports a repeated terminal outcome as a status conflict without repeating calendar writes', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'appointment_invalid_outcome' } })
    await expect(executeMobileAppointmentCommand({
      ...command, command: 'outcome', appointmentId: appointment.id, expectedVersion: 2,
      payload: { outcome: 'cancelled', notes: appointment.notes },
    })).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('Refresh the calendar') })
    expect(mocks.calendar).not.toHaveBeenCalled()
  })
})

it('maps the durable calendar owner from the one-to-one ledger without inventing an assignee owner', () => {
  expect(mapMobileAppointment({
    ...appointment, mobile_appointment_calendar_sync: { owner_email: 'casey@savingkc.com' },
  }).sync.ownerEmail).toBe('casey@savingkc.com')
  expect(mapMobileAppointment(appointment).sync.ownerEmail).toBeNull()
})

describe('standalone appointment effects', () => {
  it('persists without a synthetic lead or seller lifecycle/conversion', async () => {
    vi.clearAllMocks()
    const standalone = { ...appointment, lead_id: null, provider_sync_status: 'synced' }
    mocks.rpc.mockResolvedValue({ data: { created: true, changed: true, replayed: false, appointment: standalone }, error: null })
    mocks.calendar.mockResolvedValue({ status: 'synced' })
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ data: standalone, error: null }) }) }) })
    const result = await executeMobileAppointmentCommand({ ...command, leadId: null, payload: { ...command.payload, leadId: null } })
    expect(result.appointment.leadId).toBeNull()
    expect(result.sideEffects).toMatchObject({ lifecycle: 'not_applicable', conversion: 'not_applicable', provider: 'synced' })
    expect(mocks.lifecycle).not.toHaveBeenCalled()
    expect(mocks.conversion).not.toHaveBeenCalled()
    expect(mocks.rpc.mock.calls[0][1].p_lead_id).toBeNull()
  })
})
