import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appointment: vi.fn(),
  evidence: vi.fn(),
  advance: vi.fn(),
  conversion: vi.fn(),
}))

vi.mock('@/lib/appointments', () => ({ upsertAppointmentFromCall: mocks.appointment }))
vi.mock('@/lib/server/heir-attempt-evidence', () => ({ insertHeirAttemptEvidenceOnce: mocks.evidence }))
vi.mock('@/lib/pipeline-auto-advance', () => ({ checkAutoAdvance: mocks.advance }))
vi.mock('@/lib/ppc/appointment-booked-conversion', () => ({
  queuePpcAppointmentBookedConversion: mocks.conversion,
}))

import { recordHeirAppointment } from './heir-appointment-command'

describe('canonical heir appointments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appointment.mockResolvedValue({
      id: 'appointment-1',
      scheduled_at: '2027-08-24T15:00:00.000Z',
      type: 'phone_call',
    })
    mocks.evidence.mockResolvedValue({ id: 'activity-1', metadata: null })
    mocks.advance.mockResolvedValue(undefined)
    mocks.conversion.mockResolvedValue({ queued: true, reason: 'queued' })
  })

  it('persists appointment, activity, lifecycle, and conversion evidence with one attempt key', async () => {
    const result = await recordHeirAppointment({
      leadId: 'lead-1',
      actorName: 'Casey',
      appointmentAt: '2027-08-24T15:00:00.000Z',
      notes: 'Meet at property',
      clientAttemptId: 'attempt-1',
      prospectPhoneId: 'phone-1',
      heirName: 'Jamie Heir',
    })

    expect(result).toEqual({ appointmentId: 'appointment-1', activityId: 'activity-1' })
    expect(mocks.appointment).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-1',
      assignedTo: 'Casey',
      source: 'crm_call',
    }))
    expect(mocks.evidence).toHaveBeenCalledWith(expect.objectContaining({
      activityType: 'appointment',
      action: 'appointment_set',
      clientAttemptId: 'attempt-1',
    }))
    expect(mocks.advance).toHaveBeenCalledWith('lead-1', 'appointment_set')
    expect(mocks.conversion).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 'appointment-1',
      activityId: 'activity-1',
      source: 'heir_dialer',
    }))
  })

  it('fails closed when the canonical appointment cannot be saved', async () => {
    mocks.appointment.mockResolvedValue(null)

    await expect(recordHeirAppointment({
      leadId: 'lead-1',
      actorName: 'Casey',
      appointmentAt: '2027-08-24T15:00:00.000Z',
      notes: null,
      clientAttemptId: 'attempt-1',
      prospectPhoneId: 'phone-1',
      heirName: null,
    })).rejects.toThrow('Appointment could not be saved')
    expect(mocks.evidence).not.toHaveBeenCalled()
  })
})
