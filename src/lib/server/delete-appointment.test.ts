import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  lifecycle: vi.fn(),
  calendar: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }))
vi.mock('@/lib/server/crm-lifecycle', () => ({ applyCrmLifecycleCommand: mocks.lifecycle }))
vi.mock('@/lib/google-calendar', () => ({
  deleteOwnedAppointmentGoogleEvent: mocks.calendar,
  googleCalendarDeleteWarning: (result: { status: string; reason?: string }, hadEvent: boolean) => (
    hadEvent && result.status === 'skipped' && result.reason !== 'no_event'
      ? 'Google Calendar event was not removed.'
      : null
  ),
}))

import {
  appointmentDeleteRollbackStage,
  chooseAppointmentToDelete,
  deleteCrmAppointment,
  readDeleteAppointmentCommand,
  selectLeadAppointmentSnapshot,
} from './delete-appointment'

const LEAD_ID = '10000000-0000-4000-8000-000000000001'
const APPOINTMENT_ID = '20000000-0000-4000-8000-000000000002'
const NOW = Date.parse('2026-09-23T15:00:00.000Z')

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: APPOINTMENT_ID,
    lead_id: LEAD_ID,
    status: 'scheduled',
    scheduled_at: '2026-09-24T15:00:00.000Z',
    notes: 'Mistake booking',
    assigned_to: 'Ernest',
    google_event_id: 'evt-1',
    ...overrides,
  }
}

function installDb(options: {
  station?: string
  rows?: Array<Record<string, unknown>>
  activities?: Array<{ id: string; metadata: Record<string, unknown> }>
}) {
  const state = {
    station: options.station ?? 'appointment_set',
    rows: options.rows ?? [appointment()],
    activities: options.activities ?? [{ id: 'act-1', metadata: { appointment_id: APPOINTMENT_ID, status: 'scheduled' } }],
    deletedIds: [] as string[],
    leadUpdates: [] as unknown[],
    activityUpdates: [] as unknown[],
    inserts: [] as unknown[],
  }
  mocks.from.mockImplementation((table: string) => {
    if (table === 'leads') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { station: state.station }, error: null }) }) }),
        update: (payload: unknown) => {
          state.leadUpdates.push(payload)
          return { eq: async () => ({ error: null }) }
        },
      }
    }
    if (table === 'appointments') {
      return {
        select: () => ({ eq: async () => ({ data: state.rows, error: null }) }),
        delete: () => ({
          eq: (_column: string, id: string) => ({
            eq: async () => {
              state.deletedIds.push(id)
              state.rows = state.rows.filter((row) => row.id !== id)
              return { error: null }
            },
          }),
        }),
      }
    }
    if (table === 'lead_activities') {
      return {
        select: () => ({ eq: () => ({ contains: async () => ({ data: state.activities, error: null }) }) }),
        update: (payload: unknown) => {
          state.activityUpdates.push(payload)
          return { eq: () => ({ eq: async () => ({ error: null }) }) }
        },
        insert: (payload: unknown) => {
          state.inserts.push(payload)
          return Promise.resolve({ error: null })
        },
      }
    }
    throw new Error(`Unexpected table ${table}`)
  })
  return state
}

describe('appointment delete decisions', () => {
  it('requires a real contact and rejects a bad appointment id', () => {
    expect(readDeleteAppointmentCommand({ leadId: 'lead-1' })).toMatchObject({ ok: false, status: 400 })
    expect(readDeleteAppointmentCommand({
      leadId: LEAD_ID,
      appointmentId: 'not-a-uuid',
    })).toMatchObject({ ok: false, status: 400 })
    expect(readDeleteAppointmentCommand({
      leadId: LEAD_ID,
      appointmentId: APPOINTMENT_ID,
      scheduledAt: '2026-09-24T15:00:00.000Z',
    })).toEqual({
      ok: true,
      leadId: LEAD_ID,
      appointmentId: APPOINTMENT_ID,
      scheduledAt: '2026-09-24T15:00:00.000Z',
    })
  })

  it('rolls Appointment Set back to contacted only when no non-cancelled appointment remains', () => {
    expect(appointmentDeleteRollbackStage('appointment_set', 0)).toBe('contacted')
    expect(appointmentDeleteRollbackStage('appointment_set', 1)).toBeNull()
    expect(appointmentDeleteRollbackStage('offer_made', 0)).toBeNull()
    expect(appointmentDeleteRollbackStage('qualified', 0)).toBeNull()
  })

  it('keeps the next upcoming appointment on the contact snapshot', () => {
    expect(selectLeadAppointmentSnapshot([
      { status: 'completed', scheduled_at: '2026-09-20T15:00:00.000Z', notes: 'Done' },
      { status: 'scheduled', scheduled_at: '2026-09-25T15:00:00.000Z', notes: 'Keep' },
      { status: 'cancelled', scheduled_at: '2026-09-24T15:00:00.000Z', notes: 'Gone' },
    ], NOW)).toEqual({
      appointment_date: '2026-09-25T15:00:00.000Z',
      appointment_notes: 'Keep',
    })
    expect(selectLeadAppointmentSnapshot([
      { status: 'completed', scheduled_at: '2026-09-20T15:00:00.000Z', notes: 'Done' },
    ], NOW)).toEqual({ appointment_date: null, appointment_notes: null })
  })

  it('targets the requested row and otherwise the only active booking', () => {
    const rows = [
      appointment(),
      appointment({ id: '30000000-0000-4000-8000-000000000003', status: 'cancelled', google_event_id: null }),
    ]
    expect(chooseAppointmentToDelete({ rows, appointmentId: APPOINTMENT_ID })).toMatchObject({
      ok: true,
      appointment: { id: APPOINTMENT_ID },
    })
    expect(chooseAppointmentToDelete({
      rows: [appointment({ status: 'completed', google_event_id: null })],
    })).toMatchObject({ ok: true, appointment: { status: 'completed' } })
    expect(chooseAppointmentToDelete({ rows: [] })).toEqual({ ok: true, appointment: null })
    expect(chooseAppointmentToDelete({
      rows: [appointment(), appointment({ id: '30000000-0000-4000-8000-000000000003' })],
    })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('deleteCrmAppointment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.calendar.mockResolvedValue({ status: 'synced', eventId: 'evt-1' })
    mocks.lifecycle.mockResolvedValue({ stage: 'contacted', fromStage: 'appointment_set' })
  })

  it('hard-deletes the row, removes the Google event, and leaves Appointment Set', async () => {
    const state = installDb({})
    const result = await deleteCrmAppointment({
      leadId: LEAD_ID,
      appointmentId: APPOINTMENT_ID,
      actor: { email: 'ernest@savingkc.com', name: 'Ernest' },
      now: NOW,
    })

    expect(result).toMatchObject({
      ok: true,
      deleted: true,
      appointmentId: APPOINTMENT_ID,
      rolledBack: true,
      station: 'contacted',
      warnings: [],
    })
    expect(state.deletedIds).toEqual([APPOINTMENT_ID])
    expect(state.leadUpdates).toEqual([expect.objectContaining({
      appointment_date: null,
      appointment_notes: null,
    })])
    expect(state.activityUpdates).toEqual([expect.objectContaining({
      metadata: expect.objectContaining({ status: 'dismissed', resolution: 'appointment_deleted' }),
    })])
    expect(state.inserts).toEqual([expect.objectContaining({
      activity_type: 'appointment_outcome',
      description: 'Appointment deleted',
      agent: 'Ernest',
    })])
    expect(mocks.calendar).toHaveBeenCalledWith(expect.objectContaining({
      actorEmail: 'ernest@savingkc.com',
      appointment: { id: APPOINTMENT_ID, google_event_id: 'evt-1' },
    }))
    expect(mocks.lifecycle).toHaveBeenCalledWith(expect.objectContaining({
      leadId: LEAD_ID,
      stage: 'contacted',
      reason: 'Appointment deleted',
      actorEmail: 'ernest@savingkc.com',
      actorName: 'Ernest',
    }))
  })

  it('still deletes the CRM row when Google Calendar deletion fails', async () => {
    const state = installDb({})
    mocks.calendar.mockResolvedValue({ status: 'skipped', reason: 'calendar_delete_failed' })
    const result = await deleteCrmAppointment({
      leadId: LEAD_ID,
      appointmentId: APPOINTMENT_ID,
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      now: NOW,
    })
    expect(result).toMatchObject({
      ok: true,
      deleted: true,
      warnings: ['Google Calendar event was not removed.'],
    })
    expect(state.deletedIds).toEqual([APPOINTMENT_ID])
  })

  it('keeps Appointment Set when another non-cancelled appointment remains', async () => {
    const state = installDb({
      rows: [
        appointment({ google_event_id: null }),
        appointment({
          id: '30000000-0000-4000-8000-000000000003',
          scheduled_at: '2026-09-26T15:00:00.000Z',
          notes: 'Real visit',
          google_event_id: null,
        }),
      ],
    })
    const result = await deleteCrmAppointment({
      leadId: LEAD_ID,
      appointmentId: APPOINTMENT_ID,
      actor: { email: 'ernest@savingkc.com', name: 'Ernest' },
      now: NOW,
    })
    expect(result).toMatchObject({ ok: true, rolledBack: false, station: 'appointment_set' })
    expect(mocks.lifecycle).not.toHaveBeenCalled()
    expect(state.leadUpdates).toEqual([expect.objectContaining({
      appointment_date: '2026-09-26T15:00:00.000Z',
      appointment_notes: 'Real visit',
    })])
  })

  it('does not move a later deal stage backward', async () => {
    installDb({ station: 'offer_made' })
    const result = await deleteCrmAppointment({
      leadId: LEAD_ID,
      appointmentId: APPOINTMENT_ID,
      actor: { email: 'ernest@savingkc.com', name: 'Ernest' },
      now: NOW,
    })
    expect(result).toMatchObject({ ok: true, rolledBack: false, station: 'offer_made' })
    expect(mocks.lifecycle).not.toHaveBeenCalled()
  })
})
