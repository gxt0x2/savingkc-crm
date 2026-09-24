import { supabaseAdmin } from '@/lib/supabase/admin'
import { getValidAccessTokenResult, hasGoogleOAuthConfig } from '@/lib/gmail-sync'
import { loadActorGoogleOAuthToken, type StoredGoogleToken } from '@/lib/gmail-send'
import { CALENDAR_SCOPE, formatGmailSendError, hasGoogleScope } from '@/lib/google-oauth-scopes'

export type GoogleCalendarUpsertInput = {
  accessToken: string
  eventId?: string | null
  summary: string
  description?: string | null
  location?: string | null
  start: string
  end: string
  timeZone?: string
  fetchImpl?: typeof fetch
}

export type GoogleCalendarUpsertResult =
  | { ok: true; eventId: string }
  | { ok: false; error: string; status: number }

export type AppointmentCalendarSyncResult =
  | { status: 'synced'; eventId: string }
  | { status: 'skipped'; reason: string }

const TYPE_LABELS: Record<string, string> = {
  in_person: 'In-Person Visit',
  phone_call: 'Phone Call',
  google_meet: 'Google Meet',
  onsite: 'Onsite Visit',
  virtual: 'Virtual Meeting',
}

export function appointmentEventTimes(scheduledAt: string, type?: string | null): { start: string; end: string } {
  const startMs = new Date(scheduledAt).getTime()
  const durationMs = type === 'in_person' || type === 'onsite' ? 60 * 60 * 1000 : 30 * 60 * 1000
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + durationMs).toISOString(),
  }
}

/**
 * Calendar writeback uses the signed-in CRM user's connected Google account.
 * The appointment assignee stays an operations field and does not choose the mailbox.
 */
export function selectAppointmentGoogleOwnerEmail(input: {
  actorEmail: string
  assignedTo?: string | null
}): string | null {
  // assignedTo is the CRM owner. It must not select another person's Google account.
  void input.assignedTo
  const actorEmail = input.actorEmail.trim().toLowerCase()
  return actorEmail || null
}

const EXPECTED_CALENDAR_SYNC_FAILURES = new Set([
  'missing_calendar',
  'token_refresh_failed',
  'reauthorization_required',
  'google_oauth_not_configured',
  'calendar_api_failed',
  'calendar_sync_failed',
  'calendar_delete_failed',
])

export function googleCalendarSyncWarning(result: AppointmentCalendarSyncResult): string | null {
  if (result.status !== 'skipped' || !EXPECTED_CALENDAR_SYNC_FAILURES.has(result.reason)) return null
  if (result.reason === 'calendar_delete_failed') return 'Google Calendar event was not removed.'
  if (result.reason === 'calendar_api_failed' || result.reason === 'calendar_sync_failed') {
    return 'Google Calendar was not updated.'
  }
  return formatGmailSendError(result.reason)
}

export function googleCalendarDeleteWarning(
  result: AppointmentCalendarSyncResult,
  hadEvent: boolean,
): string | null {
  if (!hadEvent || result.status === 'synced' || result.reason === 'no_event') return null
  return googleCalendarSyncWarning(result) ?? 'Google Calendar event was not removed.'
}

function skipCalendarSync(appointmentId: string, reason: string): AppointmentCalendarSyncResult {
  const line = `[google-calendar] skip ${appointmentId}: ${reason}`
  if (EXPECTED_CALENDAR_SYNC_FAILURES.has(reason)) console.warn(line)
  else console.info(line)
  return { status: 'skipped', reason }
}

function calendarEventBody(input: GoogleCalendarUpsertInput) {
  const timeZone = input.timeZone || 'America/Chicago'
  return {
    summary: input.summary,
    description: input.description || undefined,
    location: input.location || undefined,
    start: { dateTime: input.start, timeZone },
    end: { dateTime: input.end, timeZone },
  }
}

export async function deleteGoogleCalendarEvent(input: {
  accessToken: string
  eventId: string
  fetchImpl?: typeof fetch
}): Promise<GoogleCalendarUpsertResult> {
  const eventId = input.eventId.trim()
  if (!eventId) return { ok: false, error: 'Missing Google Calendar event id', status: 400 }
  const fetchImpl = input.fetchImpl || fetch
  const res = await fetchImpl(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${input.accessToken}` } },
  )
  if (res.ok || res.status === 404 || res.status === 410) return { ok: true, eventId }
  const payload = await res.json().catch(() => ({})) as { error?: { message?: string } }
  const error = payload.error?.message || `Google Calendar delete failed (${res.status})`
  console.warn(`[google-calendar] delete failed: ${res.status} ${error}`)
  return { ok: false, error, status: res.status }
}

export async function upsertGoogleCalendarEvent(input: GoogleCalendarUpsertInput): Promise<GoogleCalendarUpsertResult> {
  const fetchImpl = input.fetchImpl || fetch
  const headers = {
    Authorization: `Bearer ${input.accessToken}`,
    'Content-Type': 'application/json',
  }
  const body = JSON.stringify(calendarEventBody(input))
  const eventId = input.eventId?.trim()
  const url = eventId
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`
    : 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

  const res = await fetchImpl(url, { method: eventId ? 'PATCH' : 'POST', headers, body })
  if (eventId && res.status === 404) {
    return upsertGoogleCalendarEvent({ ...input, eventId: null })
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => ({})) as { error?: { message?: string } }
    const error = payload.error?.message || `Google Calendar ${eventId ? 'update' : 'create'} failed (${res.status})`
    console.warn(`[google-calendar] upsert failed: ${res.status} ${error}`)
    return { ok: false, error, status: res.status }
  }

  const data = await res.json() as { id?: string }
  if (!data.id) return { ok: false, error: 'Google Calendar did not return an event id', status: res.status }
  return { ok: true, eventId: data.id }
}

type CalendarAccessInput = {
  actorEmail: string
  assignedTo?: string | null
  appointmentId: string
  loadToken?: (email: string) => Promise<StoredGoogleToken | null>
  getAccessToken?: typeof getValidAccessTokenResult
}

async function resolveAppointmentCalendarAccess(input: CalendarAccessInput): Promise<
  | { ok: true; accessToken: string }
  | { ok: false; result: AppointmentCalendarSyncResult }
> {
  const ownerEmail = selectAppointmentGoogleOwnerEmail({
    actorEmail: input.actorEmail,
    assignedTo: input.assignedTo,
  })
  if (!ownerEmail) {
    console.info(`[google-calendar] skip ${input.appointmentId}: no signed-in user for calendar writeback`)
    return { ok: false, result: { status: 'skipped', reason: 'not_owner' } }
  }
  if (!hasGoogleOAuthConfig()) {
    return { ok: false, result: skipCalendarSync(input.appointmentId, 'google_oauth_not_configured') }
  }

  const loadToken = input.loadToken || loadActorGoogleOAuthToken
  const token = await loadToken(ownerEmail)
  if (!token) {
    return { ok: false, result: skipCalendarSync(input.appointmentId, 'no_token') }
  }
  if (!hasGoogleScope(token.scope, CALENDAR_SCOPE)) {
    return { ok: false, result: skipCalendarSync(input.appointmentId, 'missing_calendar') }
  }

  const getAccessToken = input.getAccessToken || getValidAccessTokenResult
  const tokenResult = await getAccessToken(token)
  if (!tokenResult.accessToken) {
    return { ok: false, result: skipCalendarSync(input.appointmentId, tokenResult.error || 'token_refresh_failed') }
  }
  return { ok: true, accessToken: tokenResult.accessToken }
}

export async function deleteOwnedAppointmentGoogleEvent(input: {
  actorEmail: string
  assignedTo?: string | null
  appointment: { id: string; google_event_id?: string | null }
  fetchImpl?: typeof fetch
  loadToken?: (email: string) => Promise<StoredGoogleToken | null>
  getAccessToken?: typeof getValidAccessTokenResult
}): Promise<AppointmentCalendarSyncResult> {
  const eventId = input.appointment.google_event_id?.trim() || ''
  if (!eventId) return { status: 'skipped', reason: 'no_event' }
  const access = await resolveAppointmentCalendarAccess({
    actorEmail: input.actorEmail,
    assignedTo: input.assignedTo,
    appointmentId: input.appointment.id,
    loadToken: input.loadToken,
    getAccessToken: input.getAccessToken,
  })
  if (!access.ok) return access.result
  const deleted = await deleteGoogleCalendarEvent({
    accessToken: access.accessToken,
    eventId,
    fetchImpl: input.fetchImpl,
  })
  if (!deleted.ok) {
    console.warn(`[google-calendar] delete ${input.appointment.id}: ${deleted.error}`)
    return { status: 'skipped', reason: 'calendar_delete_failed' }
  }
  return { status: 'synced', eventId }
}

export async function syncOwnedAppointmentToGoogleCalendar(input: {
  actorEmail: string
  assignedTo?: string | null
  appointment: {
    id: string
    scheduled_at: string
    type?: string | null
    notes?: string | null
    address?: string | null
    google_event_id?: string | null
  }
  leadName?: string | null
  fetchImpl?: typeof fetch
  loadToken?: (email: string) => Promise<StoredGoogleToken | null>
  getAccessToken?: typeof getValidAccessTokenResult
}): Promise<AppointmentCalendarSyncResult> {
  const access = await resolveAppointmentCalendarAccess({
    actorEmail: input.actorEmail,
    assignedTo: input.assignedTo,
    appointmentId: input.appointment.id,
    loadToken: input.loadToken,
    getAccessToken: input.getAccessToken,
  })
  if (!access.ok) return access.result

  const times = appointmentEventTimes(input.appointment.scheduled_at, input.appointment.type)
  const typeLabel = TYPE_LABELS[input.appointment.type || ''] || 'Appointment'
  const leadName = input.leadName?.trim() || 'seller'
  const upsert = await upsertGoogleCalendarEvent({
    accessToken: access.accessToken,
    eventId: input.appointment.google_event_id,
    summary: `${typeLabel} with ${leadName}`,
    description: input.appointment.notes || `CRM appointment ${input.appointment.id}`,
    location: input.appointment.address,
    start: times.start,
    end: times.end,
    fetchImpl: input.fetchImpl,
  })

  if (!upsert.ok) {
    console.warn(`[google-calendar] skip ${input.appointment.id}: calendar_api_failed ${upsert.error}`)
    return { status: 'skipped', reason: 'calendar_api_failed' }
  }

  const { error } = await supabaseAdmin()
    .from('appointments')
    .update({ google_event_id: upsert.eventId, updated_at: new Date().toISOString() })
    .eq('id', input.appointment.id)
  if (error) {
    console.warn(`[google-calendar] stored event ${upsert.eventId} but failed to persist google_event_id:`, error)
  }
  return { status: 'synced', eventId: upsert.eventId }
}
