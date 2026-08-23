import { describe, expect, it } from 'vitest'

import { buildAppointmentCommand } from './appointment-command'

const now = Date.parse('2026-08-23T12:00:00.000Z')

describe('appointment commands', () => {
  it('normalizes the schedule and permits intentional operating-roster delegation', () => {
    expect(buildAppointmentCommand({
      leadId: 'lead-1',
      type: 'in_person',
      scheduledAt: '2026-08-24T15:00:00.000Z',
      assignedTo: 'casey',
      notes: ' Seller confirmed ',
      sendReminder: true,
      phone: '+19999999999',
    }, 'Ernest Dodson', now)).toEqual({
      ok: true,
      command: {
        leadId: 'lead-1',
        type: 'in_person',
        scheduledAt: '2026-08-24T15:00:00.000Z',
        assignedTo: 'Casey',
        notes: 'Seller confirmed',
        sendReminder: true,
      },
    })
  })

  it('rejects arbitrary assignees, invalid types, and non-future schedules', () => {
    expect(buildAppointmentCommand({
      leadId: 'lead-1', scheduledAt: '2026-08-24T15:00:00.000Z', assignedTo: 'Fake Agent',
    }, 'Ernest', now)).toMatchObject({ ok: false, status: 403 })
    expect(buildAppointmentCommand({
      leadId: 'lead-1', type: 'vacation', scheduledAt: '2026-08-24T15:00:00.000Z',
    }, 'Ernest', now)).toMatchObject({ ok: false, status: 400 })
    expect(buildAppointmentCommand({
      leadId: 'lead-1', scheduledAt: '2026-08-22T15:00:00.000Z',
    }, 'Ernest', now)).toMatchObject({ ok: false, status: 400 })
  })
})
