import { describe, expect, it } from 'vitest'
import { parseAppointmentInstant } from './appointment-instant'
import { buildMobileAppointmentCreate, buildMobileAppointmentEdit, buildMobileAppointmentOutcome, buildMobileAppointmentReschedule } from './mobile-appointment-command'

const input = {
  title: 'Team planning', type: 'phone_call', assignedTo: 'Ernest',
  scheduledAt: '2026-10-04T10:00', endsAt: '2026-10-04T11:00', timeZone: 'America/Chicago',
}
describe('standalone calendar save times', () => {
  it('saves the screenshot tomorrow at 10 AM without a seller and normalizes Central time', () => {
    expect(buildMobileAppointmentCreate(input, 'Ernest', Date.parse('2026-10-03T22:00Z')))
      .toMatchObject({ ok: true, value: { leadId: null, scheduledAt: '2026-10-04T15:00:00.000Z', endsAt: '2026-10-04T16:00:00.000Z' } })
  })
  it('uses DST transitions and rejects nonexistent or ambiguous wall times', () => {
    expect(parseAppointmentInstant('2026-03-08T01:30')).toBe('2026-03-08T07:30:00.000Z')
    expect(parseAppointmentInstant('2026-03-08T03:30')).toBe('2026-03-08T08:30:00.000Z')
    expect(parseAppointmentInstant('2026-03-08T02:30')).toBeNull()
    expect(parseAppointmentInstant('2026-11-01T01:30')).toBeNull()
    expect(parseAppointmentInstant('2026-11-01T01:30:00-06:00')).toBe('2026-11-01T07:30:00.000Z')
    expect(parseAppointmentInstant('2026-02-30T10:00')).toBeNull()
  })
  it('checks the actual save instant while preserving historical notes and cancel', () => {
    const now = Date.parse('2026-10-04T15:00Z')
    expect(buildMobileAppointmentCreate(input, 'Ernest', now)).toMatchObject({ ok: false })
    expect(buildMobileAppointmentReschedule({ ...input, expectedVersion: 1 }, now)).toMatchObject({ ok: false })
    expect(buildMobileAppointmentEdit({ expectedVersion: 1, patch: { scheduledAt: input.scheduledAt } }, now)).toMatchObject({ ok: false })
    expect(buildMobileAppointmentEdit({ expectedVersion: 1, patch: { notes: 'Historical note' } }, now)).toMatchObject({ ok: true })
    expect(buildMobileAppointmentOutcome({ expectedVersion: 1, outcome: 'cancelled' })).toMatchObject({ ok: true, value: { leadId: null } })
  })
})
