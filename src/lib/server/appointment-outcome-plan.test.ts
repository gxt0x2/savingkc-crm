import { describe, expect, it } from 'vitest'

import {
  nextAppointmentDate,
  nextAppointmentFollowUpDue,
  planAppointmentOutcome,
  readAppointmentOutcomeDetails,
  resolveOutcomeStageMove,
  type AppointmentOutcomeRequest,
} from './appointment-outcome-plan'

const now = new Date('2026-09-24T15:00:00.000Z')
const leadId = '11111111-1111-4111-8111-111111111111'
const appointmentId = '22222222-2222-4222-8222-222222222222'

function request(overrides: Partial<AppointmentOutcomeRequest> = {}): AppointmentOutcomeRequest {
  return {
    leadId,
    appointmentId,
    outcome: 'completed',
    notes: null,
    expectedVersion: null,
    completedNextStep: 'qualified',
    followUp: null,
    notInterested: false,
    deadReason: null,
    deadReasonNotes: null,
    replacementAppointment: null,
    ...overrides,
  }
}

function plan(overrides: Partial<AppointmentOutcomeRequest> = {}, context?: { stage?: string; qualified?: boolean; status?: string }) {
  return planAppointmentOutcome({
    request: request(overrides),
    currentStage: context?.stage ?? 'appointment_set',
    qualified: context?.qualified ?? true,
    appointmentStatus: context?.status ?? 'scheduled',
    now,
  })
}

describe('appointment outcome plan', () => {
  it('moves a completed appointment to offer made when an offer was presented', () => {
    const result = plan({ completedNextStep: 'offer_presented' })
    expect(result).toMatchObject({
      ok: true,
      plan: { status: 'completed', stage: 'offer_made', backwardException: false, followUp: null, stopReminders: true },
    })
  })

  it('moves a completed appointment back to qualified when no offer was presented', () => {
    const result = plan({ completedNextStep: 'qualified' })
    expect(result).toMatchObject({
      ok: true,
      plan: {
        stage: 'qualified',
        backwardException: true,
        reason: expect.stringContaining('Outcome-driven stage exception'),
      },
    })
  })

  it('keeps the current stage after a completed appointment only when a follow-up task is saved', () => {
    expect(plan({ completedNextStep: 'stay_with_follow_up' })).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringContaining('follow-up'),
    })
    const dueAt = '2026-09-25T13:30:00.000Z'
    expect(plan({
      completedNextStep: 'stay_with_follow_up',
      followUp: { title: 'Send the repair list', notes: null, dueAt },
    })).toMatchObject({
      ok: true,
      plan: { stage: null, backwardException: false, followUp: { title: 'Send the repair list', dueAt } },
    })
  })

  it('requires the completed appointment to say what happened next', () => {
    expect(plan({ completedNextStep: null })).toMatchObject({ ok: false, status: 400 })
  })

  it('moves a no-show to qualified and creates a follow-up when the lead is qualified', () => {
    const result = plan({ outcome: 'no_show', completedNextStep: null })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.stage).toBe('qualified')
    expect(result.plan.backwardException).toBe(true)
    expect(result.plan.followUp?.title).toMatch(/missed appointment/i)
  })

  it('moves a no-show to contacted when the lead was never qualified', () => {
    const result = plan({ outcome: 'no_show', completedNextStep: null }, { stage: 'appointment_set', qualified: false })
    expect(result).toMatchObject({
      ok: true,
      plan: { stage: 'contacted', backwardException: true, followUp: expect.objectContaining({ title: expect.stringMatching(/missed/i) }) },
    })
  })

  it('moves a not-interested cancellation to dead only with a dead reason', () => {
    expect(plan({ outcome: 'cancelled', completedNextStep: null, notInterested: true })).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringContaining('dead reason'),
    })
    expect(plan({
      outcome: 'cancelled',
      completedNextStep: null,
      notInterested: true,
      deadReason: 'other',
    })).toMatchObject({ ok: false, error: expect.stringContaining('Notes') })
    expect(plan({
      outcome: 'cancelled',
      completedNextStep: null,
      notInterested: true,
      deadReason: 'not_selling',
    })).toMatchObject({
      ok: true,
      plan: { stage: 'dead', deadReason: 'not_selling', followUp: null, backwardException: false },
    })
  })

  it('moves any other cancellation to qualified and creates a task', () => {
    const result = plan({ outcome: 'cancelled', completedNextStep: null })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.stage).toBe('qualified')
    expect(result.plan.followUp?.title).toMatch(/cancelled/i)
  })

  it('stays at appointment set when a reschedule saves a new future appointment', () => {
    const result = plan({
      outcome: 'rescheduled',
      completedNextStep: null,
      replacementAppointment: {
        scheduledAt: '2026-09-30T18:00:00.000Z',
        endsAt: '2026-09-30T19:00:00.000Z',
        type: 'phone_call',
        title: 'New seller call',
        location: null,
        timeZone: 'America/Chicago',
        notes: null,
      },
    })
    expect(result).toMatchObject({
      ok: true,
      plan: { status: 'rescheduled', stage: null, followUp: null, replacementAppointment: expect.objectContaining({ scheduledAt: '2026-09-30T18:00:00.000Z' }) },
    })
    expect(nextAppointmentDate([
      { id: appointmentId, scheduled_at: '2026-09-16T15:00:00.000Z', status: 'rescheduled', notes: 'old' },
      { id: '33333333-3333-4333-8333-333333333333', scheduled_at: '2026-09-30T18:00:00.000Z', status: 'scheduled', notes: 'new' },
    ], now.getTime(), [appointmentId])).toEqual({
      appointment_date: '2026-09-30T18:00:00.000Z',
      appointment_notes: 'new',
    })
  })

  it('moves a reschedule with no future appointment to qualified and creates a reschedule task', () => {
    const result = plan({ outcome: 'rescheduled', completedNextStep: null })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.stage).toBe('qualified')
    expect(result.plan.backwardException).toBe(true)
    expect(result.plan.followUp?.title).toMatch(/reschedule/i)
    expect(nextAppointmentDate([
      { id: appointmentId, scheduled_at: '2026-09-23T15:00:00.000Z', status: 'scheduled' },
    ], now.getTime(), [appointmentId])).toEqual({ appointment_date: null, appointment_notes: null })
  })

  it('blocks a backward stage move unless the outcome command allows the exception', () => {
    expect(resolveOutcomeStageMove('appointment_set', 'qualified', false)).toEqual({
      stage: null,
      blocked: true,
      usedException: false,
    })
    expect(resolveOutcomeStageMove('appointment_set', 'qualified', true)).toEqual({
      stage: 'qualified',
      blocked: false,
      usedException: true,
    })
    expect(resolveOutcomeStageMove('appointment_set', 'offer_made', false).blocked).toBe(false)
  })

  it('rejects a second, different outcome on an appointment that already has one', () => {
    expect(plan({ outcome: 'no_show', completedNextStep: null }, { status: 'completed' })).toMatchObject({ ok: false, status: 409 })
  })

  it('reads a reschedule request and rejects an unknown outcome', () => {
    expect(readAppointmentOutcomeDetails({
      leadId,
      appointmentId,
      outcome: 'rescheduled',
      notes: ' Howard asked to move it ',
    })).toMatchObject({
      ok: true,
      value: { outcome: 'rescheduled', notes: 'Howard asked to move it', leadId },
    })
    expect(readAppointmentOutcomeDetails({ leadId, outcome: 'showed' })).toMatchObject({ ok: false, status: 400 })
    expect(nextAppointmentFollowUpDue(new Date('2026-09-23T20:00:00.000Z'))).toBe('2026-09-24T13:30:00.000Z')
  })
})
