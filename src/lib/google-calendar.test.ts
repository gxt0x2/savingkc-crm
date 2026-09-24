import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hasGoogleOAuthConfig: vi.fn(),
  getValidAccessTokenResult: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/gmail-sync', () => ({
  hasGoogleOAuthConfig: mocks.hasGoogleOAuthConfig,
  getValidAccessTokenResult: mocks.getValidAccessTokenResult,
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: mocks.from }),
}))

import {
  appointmentEventTimes,
  deleteGoogleCalendarEvent,
  deleteOwnedAppointmentGoogleEvent,
  googleCalendarDeleteWarning,
  googleCalendarSyncWarning,
  selectAppointmentGoogleOwnerEmail,
  syncOwnedAppointmentToGoogleCalendar,
  upsertGoogleCalendarEvent,
} from '@/lib/google-calendar'

const token = {
  id: 'tok-1',
  user_email: 'ernest@savingkc.com',
  access_token: 'access',
  refresh_token: 'refresh',
  expires_at: '2026-09-20T15:00:00.000Z',
  last_sync_at: null,
  scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.send',
}

describe('Google Calendar upsert helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasGoogleOAuthConfig.mockReturnValue(true)
    mocks.getValidAccessTokenResult.mockResolvedValue({ accessToken: 'live-token', error: null })
    mocks.update.mockReturnValue({ eq: async () => ({ error: null }) })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'appointments') return { update: mocks.update }
      throw new Error(`Unexpected table ${table}`)
    })
  })

  it('creates a primary-calendar event when no google_event_id exists', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'evt-1' }), { status: 200 }))
    const result = await upsertGoogleCalendarEvent({
      accessToken: 'live-token',
      summary: 'Phone Call with Seller',
      start: '2026-09-21T16:00:00.000Z',
      end: '2026-09-21T16:30:00.000Z',
      fetchImpl,
    })
    expect(result).toEqual({ ok: true, eventId: 'evt-1' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))
    expect(body.start.timeZone).toBe('America/Chicago')
  })

  it('patches an existing event so updates do not duplicate', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'evt-1' }), { status: 200 }))
    const result = await upsertGoogleCalendarEvent({
      accessToken: 'live-token',
      eventId: 'evt-1',
      summary: 'Rescheduled visit',
      start: '2026-09-22T16:00:00.000Z',
      end: '2026-09-22T17:00:00.000Z',
      fetchImpl,
    })
    expect(result).toEqual({ ok: true, eventId: 'evt-1' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events/evt-1',
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('recreates the event when a stored id is gone', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'evt-2' }), { status: 200 }))
    const result = await upsertGoogleCalendarEvent({
      accessToken: 'live-token',
      eventId: 'missing',
      summary: 'Visit',
      start: '2026-09-22T16:00:00.000Z',
      end: '2026-09-22T17:00:00.000Z',
      fetchImpl,
    })
    expect(result).toEqual({ ok: true, eventId: 'evt-2' })
    expect(fetchImpl).toHaveBeenNthCalledWith(1, expect.stringContaining('/events/missing'), expect.objectContaining({ method: 'PATCH' }))
    expect(fetchImpl).toHaveBeenNthCalledWith(2, expect.stringContaining('/calendars/primary/events'), expect.objectContaining({ method: 'POST' }))
  })

  it('skips without blocking when the user has no Google token', async () => {
    const fetchImpl = vi.fn()
    const result = await syncOwnedAppointmentToGoogleCalendar({
      actorEmail: 'ernest@savingkc.com',
      assignedTo: 'ernest',
      appointment: { id: 'appt-1', scheduled_at: '2026-09-21T16:00:00.000Z', type: 'phone_call' },
      leadName: 'Seller',
      loadToken: async () => null,
      fetchImpl,
    })
    expect(result).toEqual({ status: 'skipped', reason: 'no_token' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('skips when calendar scope is missing', async () => {
    const fetchImpl = vi.fn()
    const result = await syncOwnedAppointmentToGoogleCalendar({
      actorEmail: 'ernest@savingkc.com',
      assignedTo: 'ernest',
      appointment: { id: 'appt-1', scheduled_at: '2026-09-21T16:00:00.000Z', type: 'phone_call' },
      loadToken: async () => ({ ...token, scope: 'https://www.googleapis.com/auth/gmail.send' }),
      fetchImpl,
    })
    expect(result).toEqual({ status: 'skipped', reason: 'missing_calendar' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('upserts and stores google_event_id for the signed-in owner', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'evt-9' }), { status: 200 }))
    const loadToken = vi.fn().mockResolvedValue(token)
    const result = await syncOwnedAppointmentToGoogleCalendar({
      actorEmail: 'ernest@savingkc.com',
      assignedTo: 'ernest',
      appointment: {
        id: 'appt-1',
        scheduled_at: '2026-09-21T16:00:00.000Z',
        type: 'in_person',
        notes: 'Meet at the house',
        address: '123 Main',
      },
      leadName: 'Jordan Seller',
      loadToken,
      fetchImpl,
    })
    expect(loadToken).toHaveBeenCalledWith('ernest@savingkc.com')
    expect(result).toEqual({ status: 'synced', eventId: 'evt-9' })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ google_event_id: 'evt-9' }))
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))
    expect(body.summary).toBe('In-Person Visit with Jordan Seller')
    expect(body.location).toBe('123 Main')
    expect(appointmentEventTimes('2026-09-21T16:00:00.000Z', 'phone_call').end).toBe('2026-09-21T16:30:00.000Z')
  })

  it('writes the signed-in user calendar when the assignee is a different agent', async () => {
    const reviewToken = { ...token, user_email: 'savingkc@gmail.com' }
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'evt-actor' }), { status: 200 }))
    const loadToken = vi.fn().mockImplementation(async (email: string) => (
      email === 'oauth-review@savingkc.com' ? reviewToken : null
    ))
    const result = await syncOwnedAppointmentToGoogleCalendar({
      actorEmail: 'oauth-review@savingkc.com',
      assignedTo: 'Ernest',
      appointment: {
        id: 'appt-demo',
        scheduled_at: '2026-09-22T15:00:00.000Z',
        type: 'google_meet',
        notes: 'OAuth demo calendar writeback test.',
      },
      leadName: 'Seller',
      loadToken,
      fetchImpl,
    })

    expect(selectAppointmentGoogleOwnerEmail({
      actorEmail: 'oauth-review@savingkc.com',
      assignedTo: 'Ernest',
    })).toBe('oauth-review@savingkc.com')
    expect(result).toEqual({ status: 'synced', eventId: 'evt-actor' })
    expect(loadToken).toHaveBeenCalledTimes(1)
    expect(loadToken).toHaveBeenCalledWith('oauth-review@savingkc.com')
    expect(loadToken).not.toHaveBeenCalledWith('ernest@savingkc.com')
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))
    expect(body.summary).toBe('Google Meet with Seller')
    expect(body.description).toBe('OAuth demo calendar writeback test.')
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ google_event_id: 'evt-actor' }))
  })

  it('keeps Ernest and Casey on their own calendars when they are the signed-in user', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: 'evt-owner' }), { status: 200 }))
    const loadToken = vi.fn().mockImplementation(async (email: string) => {
      if (email === 'ernest@savingkc.com') return token
      if (email === 'casey@savingkc.com') return { ...token, user_email: 'casey@savingkc.com' }
      return null
    })

    const ernest = await syncOwnedAppointmentToGoogleCalendar({
      actorEmail: 'ernest@savingkc.com',
      assignedTo: 'Casey',
      appointment: { id: 'appt-ernest', scheduled_at: '2026-09-22T15:00:00.000Z', type: 'phone_call' },
      loadToken,
      fetchImpl,
    })
    const casey = await syncOwnedAppointmentToGoogleCalendar({
      actorEmail: 'casey@savingkc.com',
      assignedTo: 'casey',
      appointment: { id: 'appt-casey', scheduled_at: '2026-09-22T16:00:00.000Z', type: 'google_meet' },
      loadToken,
      fetchImpl,
    })

    expect(ernest).toEqual({ status: 'synced', eventId: 'evt-owner' })
    expect(casey).toEqual({ status: 'synced', eventId: 'evt-owner' })
    expect(loadToken).toHaveBeenNthCalledWith(1, 'ernest@savingkc.com')
    expect(loadToken).toHaveBeenNthCalledWith(2, 'casey@savingkc.com')
    expect(loadToken).not.toHaveBeenCalledWith('casey')
  })

  it('patches the actor event when the appointment already has a google_event_id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'evt-owner' }), { status: 200 }))
    const loadToken = vi.fn().mockResolvedValue({ ...token, user_email: 'savingkc@gmail.com' })
    const result = await syncOwnedAppointmentToGoogleCalendar({
      actorEmail: 'oauth-review@savingkc.com',
      assignedTo: 'Ernest',
      appointment: {
        id: 'appt-demo',
        scheduled_at: '2026-09-22T16:00:00.000Z',
        type: 'in_person',
        google_event_id: 'evt-owner',
      },
      loadToken,
      fetchImpl,
    })
    expect(result).toEqual({ status: 'synced', eventId: 'evt-owner' })
    expect(loadToken).toHaveBeenCalledWith('oauth-review@savingkc.com')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events/evt-owner',
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('does not fall back to the assignee mailbox when the actor has no Google token', async () => {
    const fetchImpl = vi.fn()
    const loadToken = vi.fn().mockResolvedValue(null)
    const result = await syncOwnedAppointmentToGoogleCalendar({
      actorEmail: 'oauth-review@savingkc.com',
      assignedTo: 'Casey',
      appointment: { id: 'appt-2', scheduled_at: '2026-09-22T15:00:00.000Z', type: 'phone_call' },
      loadToken,
      fetchImpl,
    })
    expect(result).toEqual({ status: 'skipped', reason: 'no_token' })
    expect(loadToken).toHaveBeenCalledWith('oauth-review@savingkc.com')
    expect(loadToken).not.toHaveBeenCalledWith('casey@savingkc.com')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(googleCalendarSyncWarning(result)).toBeNull()
  })

  it('warns when the owner calendar grant cannot complete the write', () => {
    expect(googleCalendarSyncWarning({ status: 'skipped', reason: 'no_token' })).toBeNull()
    expect(googleCalendarSyncWarning({ status: 'skipped', reason: 'calendar_api_failed' })).toBe('Google Calendar was not updated.')
    expect(googleCalendarSyncWarning({ status: 'skipped', reason: 'calendar_delete_failed' })).toBe('Google Calendar event was not removed.')
    expect(googleCalendarSyncWarning({ status: 'skipped', reason: 'missing_calendar' })).toMatch(/Calendar permission/)
    expect(googleCalendarSyncWarning({ status: 'synced', eventId: 'evt-1' })).toBeNull()
    expect(googleCalendarDeleteWarning({ status: 'skipped', reason: 'not_owner' }, true)).toBe('Google Calendar event was not removed.')
    expect(googleCalendarDeleteWarning({ status: 'skipped', reason: 'no_event' }, false)).toBeNull()
  })

  it('deletes the stored primary-calendar event and treats a missing event as already gone', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('gone', { status: 404 }))
    await expect(deleteGoogleCalendarEvent({
      accessToken: 'live-token',
      eventId: 'evt owner',
      fetchImpl,
    })).resolves.toEqual({ ok: true, eventId: 'evt owner' })
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://www.googleapis.com/calendar/v3/calendars/primary/events/evt%20owner',
      expect.objectContaining({ method: 'DELETE' }),
    )
    await expect(deleteGoogleCalendarEvent({
      accessToken: 'live-token',
      eventId: 'missing',
      fetchImpl,
    })).resolves.toEqual({ ok: true, eventId: 'missing' })
  })

  it('asks the assignee calendar to delete and still reports a soft failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'backend' } }), { status: 500 }))
    const result = await deleteOwnedAppointmentGoogleEvent({
      actorEmail: 'ernest@savingkc.com',
      assignedTo: 'ernest',
      appointment: { id: 'appt-1', google_event_id: 'evt-1' },
      loadToken: async () => token,
      fetchImpl,
    })
    expect(result).toEqual({ status: 'skipped', reason: 'calendar_delete_failed' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events/evt-1',
      expect.objectContaining({ method: 'DELETE' }),
    )
    await expect(deleteOwnedAppointmentGoogleEvent({
      actorEmail: 'ernest@savingkc.com',
      assignedTo: 'ernest',
      appointment: { id: 'appt-2', google_event_id: null },
      fetchImpl,
    })).resolves.toEqual({ status: 'skipped', reason: 'no_event' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
