import { describe, expect, it } from 'vitest'

import {
  buildMobileAppointmentCreate,
  buildMobileAppointmentEdit,
  buildMobileAppointmentOutcome,
  buildMobileAppointmentReschedule,
} from './mobile-appointment-command'

const now = Date.parse('2026-09-18T12:00:00.000Z')
const leadId = '11111111-1111-4111-8111-111111111111'

describe('mobile appointment command parsing', () => {
  it('normalizes the complete create editor without accepting client actor fields', () => {
    expect(buildMobileAppointmentCreate({
      leadId,
      type: 'in_person',
      scheduledAt: '2026-09-19T15:00:00-05:00',
      endsAt: '2026-09-19T16:00:00-05:00',
      title: ' Seller visit ',
      location: ' 2808 W 49th St ',
      timeZone: 'America/Chicago',
      assignedTo: 'casey',
      notes: ' Bring comps ',
      sendReminder: false,
    }, 'Ernest', now)).toEqual({
      ok: true,
      value: {
        leadId,
        type: 'in_person',
        scheduledAt: '2026-09-19T20:00:00.000Z',
        endsAt: '2026-09-19T21:00:00.000Z',
        title: 'Seller visit',
        location: '2808 W 49th St',
        timeZone: 'America/Chicago',
        assignedTo: 'Casey',
        notes: 'Bring comps',
        sendReminder: false,
      },
    })
    expect(buildMobileAppointmentCreate({
      leadId, type: 'phone_call', scheduledAt: '2026-09-19T15:00:00Z',
      endsAt: '2026-09-19T16:00:00Z', title: 'Call', location: null,
      timeZone: 'America/Chicago', assignedTo: 'Ernest', actor: 'Casey',
    }, 'Ernest', now)).toMatchObject({ ok: false })
  })

  it('requires in-person location, future bounded duration, and an authorized assignee', () => {
    const base = {
      leadId, type: 'in_person', scheduledAt: '2026-09-19T15:00:00Z',
      endsAt: '2026-09-19T16:00:00Z', title: 'Visit', location: null,
      timeZone: 'America/Chicago', assignedTo: 'Ernest', sendReminder: false,
    }
    expect(buildMobileAppointmentCreate(base, 'Ernest', now)).toMatchObject({ ok: false, status: 400 })
    expect(buildMobileAppointmentCreate({ ...base, location: '123 Main', assignedTo: 'Unknown' }, 'Ernest', now)).toMatchObject({ ok: false, status: 403 })
    expect(buildMobileAppointmentCreate({ ...base, location: '123 Main', endsAt: base.scheduledAt }, 'Ernest', now)).toMatchObject({ ok: false, status: 400 })
    expect(buildMobileAppointmentCreate({ ...base, location: '123 Main', endsAt: '2026-09-19T15:10:00Z' }, 'Ernest', now)).toMatchObject({ ok: false, status: 400 })
    expect(buildMobileAppointmentCreate({ ...base, location: '123 Main', sendReminder: true }, 'Ernest', now)).toEqual({
      ok: false,
      error: 'Seller reminders are not configured for mobile appointments.',
      status: 400,
    })
  })

  it('allows only the documented edit patch and preserves explicit clears', () => {
    expect(buildMobileAppointmentEdit({
      expectedVersion: 3,
      patch: { title: 'Updated', notes: '', location: null },
    })).toEqual({
      ok: true,
      value: { expectedVersion: 3, patch: { title: 'Updated', notes: null, location: null } },
    })
    expect(buildMobileAppointmentEdit({ expectedVersion: 3, patch: { assignedTo: 'Casey' } })).toMatchObject({ ok: false })
    expect(buildMobileAppointmentEdit({ expectedVersion: 0, patch: { title: 'Updated' } })).toMatchObject({ ok: false })
  })

  it('normalizes reschedule and outcome commands with explicit versions', () => {
    expect(buildMobileAppointmentReschedule({
      expectedVersion: 4,
      scheduledAt: '2026-09-20T15:00:00Z',
      endsAt: '2026-09-20T16:00:00Z',
      timeZone: 'America/Chicago',
      notes: 'Seller requested later',
    }, now)).toMatchObject({ ok: true, value: { expectedVersion: 4 } })
    expect(buildMobileAppointmentOutcome({
      leadId, expectedVersion: 4, outcome: 'cancelled', notes: 'Seller cancelled',
    })).toEqual({
      ok: true,
      value: { leadId, expectedVersion: 4, payload: { outcome: 'cancelled', notes: 'Seller cancelled' } },
    })
    expect(buildMobileAppointmentOutcome({ leadId, expectedVersion: 4, outcome: 'rescheduled' })).toMatchObject({ ok: false })
  })
})
