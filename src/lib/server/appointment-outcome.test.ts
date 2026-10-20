import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  lifecycle: vi.fn(),
  qualification: vi.fn(),
  createWorkItem: vi.fn(),
  qualifiedConversion: vi.fn(),
  bookedConversion: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }))
vi.mock('@/lib/server/crm-lifecycle', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/crm-lifecycle')>(),
  applyCrmLifecycleCommand: mocks.lifecycle,
}))
vi.mock('@/lib/qualification-policy', () => ({ getLeadQualificationStatus: mocks.qualification }))
vi.mock('@/lib/server/work-items', () => ({
  createWorkItem: mocks.createWorkItem,
  WorkItemError: class WorkItemError extends Error {
    code = 'unavailable'
  },
}))
vi.mock('@/lib/ppc/qualified-lead-conversion', () => ({ queuePpcQualifiedLeadConversion: mocks.qualifiedConversion }))
vi.mock('@/lib/ppc/appointment-booked-conversion', () => ({ queuePpcAppointmentBookedConversion: mocks.bookedConversion }))

import { recordAppointmentOutcome } from './appointment-outcome'
import type { AppointmentOutcomeRequest } from './appointment-outcome-plan'

const leadId = '11111111-1111-4111-8111-111111111111'
const appointmentId = '22222222-2222-4222-8222-222222222222'
const now = new Date('2026-09-24T15:00:00.000Z')
const actor = { email: 'casey@savingkc.com', name: 'Casey Davis' }

const appointment = {
  id: appointmentId,
  lead_id: leadId,
  type: 'phone_call',
  status: 'scheduled',
  scheduled_at: '2026-09-23T15:00:00.000Z',
  ends_at: '2026-09-23T15:45:00.000Z',
  title: 'Seller call',
  location: null,
  address: null,
  time_zone: 'America/Chicago',
  assigned_to: 'Casey',
  notes: null,
  sequence_enabled: true,
  version: 4,
  source: 'manual',
  created_at: '2026-09-16T15:00:00.000Z',
  updated_at: '2026-09-16T15:00:00.000Z',
  provider_event_id: null,
  provider_sync_status: 'not_configured',
  provider_synced_at: null,
  provider_sync_error: null,
  confirmation_status: 'pending',
  no_show_risk: false,
  no_show_risk_at: null,
  reschedule_requested_at: null,
}

function request(overrides: Partial<AppointmentOutcomeRequest> = {}): AppointmentOutcomeRequest {
  return {
    leadId,
    appointmentId,
    outcome: 'completed',
    notes: 'Seller attended',
    expectedVersion: 4,
    completedNextStep: 'qualified',
    followUp: null,
    notInterested: false,
    deadReason: null,
    deadReasonNotes: null,
    replacementAppointment: null,
    ...overrides,
  }
}

function chain(result: { data: unknown; error: { message?: string; code?: string } | null }) {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) query[method] = vi.fn(() => query)
  query.maybeSingle = vi.fn(async () => result)
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result))
  return query
}

describe('recordAppointmentOutcome', () => {
  const updates: Array<Record<string, unknown>> = []
  const leadUpdates: Array<Record<string, unknown>> = []
  const inserts: Array<Record<string, unknown>> = []
  const activities: Array<Record<string, unknown>> = []
  let activityError: { message: string; code?: string } | null = null
  let appointmentList: Array<Record<string, unknown>> = []
  let appointmentSelects = 0

  beforeEach(() => {
    vi.clearAllMocks()
    updates.length = 0
    leadUpdates.length = 0
    inserts.length = 0
    activities.length = 0
    activityError = null
    appointmentList = []
    appointmentSelects = 0
    mocks.qualification.mockResolvedValue({ qualified: true, missing: [] })
    mocks.lifecycle.mockImplementation(async (input) => ({
      eventId: 'event-1',
      leadId: input.leadId,
      stage: input.stage,
      fromStage: 'appointment_set',
      classification: 'opportunity',
      priority: 'hot',
      owner: 'Casey',
      deadReason: input.deadReason,
      replayed: false,
    }))
    mocks.createWorkItem.mockResolvedValue({ created: true, workItem: { key: 'activity:follow-up-1' } })
    mocks.qualifiedConversion.mockResolvedValue({ queued: false, reason: 'not_ppc' })
    mocks.bookedConversion.mockResolvedValue({ queued: false, reason: 'not_ppc' })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'appointments') {
        return {
          select: () => {
            appointmentSelects += 1
            return chain({ data: appointmentSelects === 1 ? appointment : appointmentList, error: null })
          },
          update: (payload: Record<string, unknown>) => {
            updates.push(payload)
            return chain({ data: { ...appointment, ...payload }, error: null })
          },
          insert: (payload: Record<string, unknown>) => {
            inserts.push(payload)
            return chain({ data: payload, error: null })
          },
        }
      }
      if (table === 'leads') {
        return {
          select: () => chain({ data: { id: leadId, station: 'appointment_set' }, error: null }),
          update: (payload: Record<string, unknown>) => {
            leadUpdates.push(payload)
            return chain({ data: null, error: null })
          },
        }
      }
      if (table === 'lead_activities') {
        return {
          insert: (payload: Record<string, unknown>) => {
            activities.push(payload)
            return chain({ data: null, error: activityError })
          },
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })
  })

  async function run(overrides: Partial<AppointmentOutcomeRequest> = {}, qualified = true) {
    mocks.qualification.mockResolvedValue({ qualified, missing: qualified ? [] : ['PRICE'] })
    return recordAppointmentOutcome({ actor, source: 'appointment_outcome_review', request: request(overrides), now })
  }

  it.each([
    ['completed offer', { completedNextStep: 'offer_presented' as const }, 'offer_made', false],
    ['completed without an offer', { completedNextStep: 'qualified' as const }, 'qualified', false],
    ['no-show', { outcome: 'no_show' as const, completedNextStep: null }, 'qualified', true],
    ['cancelled', { outcome: 'cancelled' as const, completedNextStep: null }, 'qualified', true],
    ['rescheduled without a new time', { outcome: 'rescheduled' as const, completedNextStep: null, notes: 'Asked to move' }, 'qualified', true],
  ])('applies %s through the lifecycle command', async (_label, overrides, stage, createsTask) => {
    const result = await run(overrides)
    expect(result.success).toBe(true)
    const outcome = 'outcome' in overrides && overrides.outcome ? overrides.outcome : 'completed'
    expect(updates[0]).toMatchObject({ status: outcome, version: 5, sequence_enabled: false })
    expect(activities[0]).toMatchObject({ activity_type: 'appointment_outcome', agent: 'Casey Davis' })
    expect(mocks.lifecycle).toHaveBeenCalledWith(expect.objectContaining({
      leadId,
      stage,
      actorEmail: actor.email,
      actorName: actor.name,
      reason: expect.stringContaining('Appointment outcome'),
    }))
    expect(leadUpdates[0]).toMatchObject({ appointment_date: null })
    if (createsTask) expect(mocks.createWorkItem).toHaveBeenCalledOnce()
    else expect(mocks.createWorkItem).not.toHaveBeenCalled()
  })

  it('moves a never-qualified no-show to contacted and still creates the follow-up', async () => {
    const result = await run({ outcome: 'no_show', completedNextStep: null, notes: null }, false)
    expect(result.stage).toMatchObject({ to: 'contacted', changed: true, exception: true })
    expect(mocks.lifecycle).toHaveBeenCalledWith(expect.objectContaining({ stage: 'contacted', deadReason: null }))
    expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({ kind: 'follow_up', leadId }))
  })

  it('marks a not-interested cancellation dead and does not invent a follow-up', async () => {
    const result = await run({
      outcome: 'cancelled',
      completedNextStep: null,
      notInterested: true,
      deadReason: 'not_selling',
      notes: 'Seller said they are staying',
    })
    expect(result.stage).toMatchObject({ to: 'dead', changed: true })
    expect(mocks.lifecycle).toHaveBeenCalledWith(expect.objectContaining({ stage: 'dead', deadReason: 'not_selling' }))
    expect(mocks.createWorkItem).not.toHaveBeenCalled()
  })

  it('keeps appointment set when the same action saves a future appointment', async () => {
    const result = await run({
      outcome: 'rescheduled',
      completedNextStep: null,
      notes: null,
      replacementAppointment: {
        scheduledAt: '2026-09-30T18:00:00.000Z',
        endsAt: '2026-09-30T19:00:00.000Z',
        type: 'phone_call',
        title: 'New seller call',
        location: null,
        timeZone: 'America/Chicago',
        notes: 'Moved from 9/23',
      },
    })
    expect(result.stage).toMatchObject({ changed: false, to: 'appointment_set' })
    expect(mocks.lifecycle).not.toHaveBeenCalled()
    expect(inserts[0]).toMatchObject({ status: 'scheduled', scheduled_at: '2026-09-30T18:00:00.000Z', sequence_enabled: false })
    expect(leadUpdates[0]).toMatchObject({ appointment_date: '2026-09-30T18:00:00.000Z' })
    expect(mocks.createWorkItem).not.toHaveBeenCalled()
  })

  it('does not report success when the timeline entry fails', async () => {
    activityError = { message: 'insert failed' }
    await expect(run()).rejects.toMatchObject({ name: 'AppointmentOutcomeError', code: 'timeline_failed', status: 500 })
    expect(mocks.lifecycle).not.toHaveBeenCalled()
    expect(mocks.createWorkItem).not.toHaveBeenCalled()
  })

  it('does not report success when the stage move fails', async () => {
    mocks.lifecycle.mockRejectedValue(new Error('lifecycle down'))
    await expect(run()).rejects.toMatchObject({ name: 'AppointmentOutcomeError', code: 'stage_failed', status: 500 })
    expect(mocks.createWorkItem).not.toHaveBeenCalled()
  })
})
