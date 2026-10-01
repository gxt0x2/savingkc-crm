import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), access: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/lib/google-calendar', () => ({ resolveAppointmentCalendarAccess: mocks.access }))

import { syncMobileAppointmentCalendar, syncMobileAppointmentGoogleEvent } from './mobile-appointment-calendar'

const appointment = {
  id: '11111111-1111-4111-8111-111111111111', version: 2, title: 'Exact mobile title',
  scheduled_at: '2026-12-01T15:00:00.000Z', ends_at: '2026-12-01T16:15:00.000Z',
  time_zone: 'America/Chicago', location: 'Kansas City', status: 'scheduled',
}
const ownerEmail = 'ernest@savingkc.com'
const eventId = `skc${appointment.id.replaceAll('-', '')}`
const event = (version: number, etag = '"etag-1"') => ({
  id: eventId, etag,
  extendedProperties: { private: {
    savingkcMobileAppointmentId: appointment.id,
    savingkcMobileAppointmentVersion: String(version),
    savingkcCalendarOwner: ownerEmail,
  } },
})
const response = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

describe('mobile appointment Google event identity', () => {
  it('creates the exact mobile window with a stable ID, no seller invite or reminders', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200, event(2)))
    const result = await syncMobileAppointmentGoogleEvent({
      appointment, ownerEmail, eventId, accessToken: 'private-token', fetchImpl,
    })
    expect(result).toEqual({ ok: true })
    const [url, init] = fetchImpl.mock.calls[1]
    expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      id: eventId, summary: appointment.title,
      start: { dateTime: appointment.scheduled_at, timeZone: appointment.time_zone },
      end: { dateTime: appointment.ends_at, timeZone: appointment.time_zone },
      reminders: { useDefault: false, overrides: [] },
      extendedProperties: { private: { savingkcCalendarOwner: ownerEmail } },
    })
    expect(body).not.toHaveProperty('attendees')
  })

  it('recognizes a prior successful POST after a lost response without creating another event', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, event(2)))
    expect(await syncMobileAppointmentGoogleEvent({ appointment, ownerEmail, eventId, accessToken: 'x', fetchImpl }))
      .toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('does not accept a POST response for the wrong appointment version', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200, event(1)))
    expect(await syncMobileAppointmentGoogleEvent({ appointment, ownerEmail, eventId, accessToken: 'x', fetchImpl }))
      .toEqual({ ok: false, reason: 'calendar_create_identity_conflict', mutationAttempted: true })
  })

  it('marks a timed-out POST as ambiguous even if the prior GET found no event', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(404))
      .mockRejectedValueOnce(new Error('network timeout'))
    expect(await syncMobileAppointmentGoogleEvent({ appointment, ownerEmail, eventId, accessToken: 'x', fetchImpl }))
      .toEqual({ ok: false, reason: 'calendar_request_failed', mutationAttempted: true })
  })

  it('rejects a collision with another appointment or owner', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, {
      ...event(2), extendedProperties: { private: { savingkcMobileAppointmentId: 'other' } },
    }))
    expect(await syncMobileAppointmentGoogleEvent({ appointment, ownerEmail, eventId, accessToken: 'x', fetchImpl }))
      .toEqual({ ok: false, reason: 'calendar_event_identity_conflict' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('updates only an older owned event with its etag and never sends attendee updates', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(200, event(1)))
      .mockResolvedValueOnce(response(200, event(2)))
    expect(await syncMobileAppointmentGoogleEvent({ appointment, ownerEmail, eventId, accessToken: 'x', fetchImpl }))
      .toEqual({ ok: true })
    expect(fetchImpl.mock.calls[1][0]).toContain(`${eventId}?sendUpdates=none`)
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'PUT', headers: { 'If-Match': '"etag-1"' } })
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).not.toHaveProperty('attendees')
  })

  it('does not overwrite a newer Google revision', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, event(3)))
    expect(await syncMobileAppointmentGoogleEvent({ appointment, ownerEmail, eventId, accessToken: 'x', fetchImpl }))
      .toEqual({ ok: false, reason: 'calendar_newer_event_conflict' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('conditionally deletes a cancelled owned event and accepts an already-absent event', async () => {
    const cancelled = { ...appointment, status: 'cancelled' }
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(200, event(1)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect(await syncMobileAppointmentGoogleEvent({ appointment: cancelled, ownerEmail, eventId, accessToken: 'x', fetchImpl }))
      .toEqual({ ok: true })
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'DELETE', headers: { 'If-Match': '"etag-1"' } })
    const absent = vi.fn().mockResolvedValue(response(404))
    expect(await syncMobileAppointmentGoogleEvent({ appointment: cancelled, ownerEmail, eventId, accessToken: 'x', fetchImpl: absent }))
      .toEqual({ ok: true })
    const deleted = vi.fn().mockResolvedValue(response(410))
    expect(await syncMobileAppointmentGoogleEvent({ appointment: cancelled, ownerEmail, eventId, accessToken: 'x', fetchImpl: deleted }))
      .toEqual({ ok: true })
    expect(deleted).toHaveBeenCalledOnce()
  })
})

describe('mobile appointment calendar ownership and receipt', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not load another operator OAuth token on a cross-actor edit', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'not_owner' }, error: null })
    expect(await syncMobileAppointmentCalendar({ appointmentId: appointment.id, actorEmail: 'casey@savingkc.com' }))
      .toMatchObject({ status: 'pending', warning: expect.stringContaining('original calendar owner') })
    expect(mocks.access).not.toHaveBeenCalled()
  })

  it('rejects a stale owner retry before loading OAuth or touching Google', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'version_conflict' }, error: null })
    await expect(syncMobileAppointmentCalendar({
      appointmentId: appointment.id, actorEmail: ownerEmail, expectedVersion: 1, requireOwner: true,
    })).rejects.toMatchObject({ status: 409 })
    expect(mocks.access).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it('finishes no-token as not_configured and keeps CRM command independent', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: 'claimed', ownerEmail, eventId, version: 2, appointment }, error: null })
      .mockResolvedValueOnce({ data: { status: 'not_configured' }, error: null })
    mocks.access.mockResolvedValue({ ok: false, result: { status: 'skipped', reason: 'no_token' } })
    expect(await syncMobileAppointmentCalendar({ appointmentId: appointment.id, actorEmail: ownerEmail }))
      .toMatchObject({ status: 'not_configured', warning: expect.stringContaining('not connected') })
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_status: 'not_configured', p_error: 'no_token' })
  })

  it('keeps an ambiguous provider write claimed and pending for explicit reconciliation', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'claimed', ownerEmail, eventId, version: 2, appointment }, error: null })
    mocks.access.mockResolvedValue({ ok: true, accessToken: 'private-token' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(404)).mockRejectedValueOnce(new Error('timeout')))
    try {
      expect(await syncMobileAppointmentCalendar({ appointmentId: appointment.id, actorEmail: ownerEmail }))
        .toMatchObject({ status: 'pending', warning: expect.stringContaining('needs review') })
      expect(mocks.rpc).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports an expired claim as review-required without loading OAuth or finishing it', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'review_required' }, error: null })
    expect(await syncMobileAppointmentCalendar({ appointmentId: appointment.id, actorEmail: ownerEmail }))
      .toMatchObject({ status: 'pending', warning: expect.stringContaining('needs review') })
    expect(mocks.access).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
})
