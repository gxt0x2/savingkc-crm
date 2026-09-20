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
  appointmentBelongsToGoogleUser,
  appointmentEventTimes,
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

  it('upserts and stores google_event_id for the owner', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'evt-9' }), { status: 200 }))
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
      loadToken: async () => token,
      fetchImpl,
    })
    expect(result).toEqual({ status: 'synced', eventId: 'evt-9' })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ google_event_id: 'evt-9' }))
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))
    expect(body.summary).toBe('In-Person Visit with Jordan Seller')
    expect(body.location).toBe('123 Main')
  })

  it('treats Ernest-owned appointments as belonging to ernest@savingkc.com', () => {
    expect(appointmentBelongsToGoogleUser({ actorEmail: 'ernest@savingkc.com', assignedTo: 'ernest' })).toBe(true)
    expect(appointmentBelongsToGoogleUser({ actorEmail: 'ernest@savingkc.com', assignedTo: 'casey' })).toBe(false)
    expect(appointmentEventTimes('2026-09-21T16:00:00.000Z', 'phone_call').end).toBe('2026-09-21T16:30:00.000Z')
  })
})
