import { supabaseAdmin } from '@/lib/supabase/admin'
import { getValidAccessTokenResult, hasGoogleOAuthConfig } from '@/lib/gmail-sync'
import { loadGoogleOAuthToken, type StoredGoogleToken } from '@/lib/gmail-send'
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

export function appointmentBelongsToGoogleUser(input: {
  actorEmail: string
  assignedTo?: string | null
}): boolean {
  const email = input.actorEmail.trim().toLowerCase()
  const assigned = (input.assignedTo || '').trim().toLowerCase()
  if (!email) return false
  if (!assigned) return true
  const local = email.split('@')[0] || ''
  return assigned === email || assigned === local || assigned.includes(local) || local.includes(assigned)
}

function assigneeMatchKeys(assignedTo: string): Set<string> {
  const assigned = assignedTo.trim().toLowerCase()
  const first = assigned.split(/\s+/)[0] || ''
  return new Set([assigned, first].filter(Boolean))
}

/**
 * The calendar to update is the assignee's connected Google account.
 * The CRM session user can schedule for that owner without being that mailbox.
 */
export function selectAppointmentGoogleOwnerEmail(input: {
  actorEmail: string
  assignedTo?: string | null
  candidateEmails?: string[]
}): string | null {
  const actorEmail = input.actorEmail.trim().toLowerCase()
  const assigned = (input.assignedTo || '').trim()
  if (!assigned) return actorEmail || null
  if (actorEmail && appointmentBelongsToGoogleUser({ actorEmail, assignedTo: assigned })) return actorEmail

  const keys = assigneeMatchKeys(assigned)
  const matches = (input.candidateEmails || [])
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email && email !== actorEmail)
    .filter((email) => {
      const local = email.split('@')[0] || ''
      return keys.has(local) || appointmentBelongsToGoogleUser({ actorEmail: email, assignedTo: assigned })
    })
  const exact = matches.filter((email) => keys.has(email.split('@')[0] || ''))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  return matches.length === 1 ? matches[0] : null
}

const EXPECTED_CALENDAR_SYNC_FAILURES = new Set([
  'missing_calendar',
  'token_refresh_failed',
  'reauthorization_required',
  'google_oauth_not_configured',
  'calendar_api_failed',
  'calendar_sync_failed',
])

export function googleCalendarSyncWarning(result: AppointmentCalendarSyncResult): string | null {
  if (result.status !== 'skipped' || !EXPECTED_CALENDAR_SYNC_FAILURES.has(result.reason)) return null
  if (result.reason === 'calendar_api_failed' || result.reason === 'calendar_sync_failed') {
    return 'Google Calendar was not updated.'
  }
  return formatGmailSendError(result.reason)
}

async function listConnectedGoogleEmails(): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from('user_oauth_tokens')
    .select('user_email')
    .eq('provider', 'google')
  if (error || !data) return []
  return data
    .map((row) => (typeof row.user_email === 'string' ? row.user_email : ''))
    .filter(Boolean)
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
  listConnectedEmails?: () => Promise<string[]>
  getAccessToken?: typeof getValidAccessTokenResult
}): Promise<AppointmentCalendarSyncResult> {
  let ownerEmail = selectAppointmentGoogleOwnerEmail({
    actorEmail: input.actorEmail,
    assignedTo: input.assignedTo,
  })
  if (!ownerEmail) {
    const listConnectedEmails = input.listConnectedEmails || listConnectedGoogleEmails
    ownerEmail = selectAppointmentGoogleOwnerEmail({
      actorEmail: input.actorEmail,
      assignedTo: input.assignedTo,
      candidateEmails: await listConnectedEmails(),
    })
  }
  if (!ownerEmail) {
    console.info(`[google-calendar] skip ${input.appointment.id}: appointment is assigned to someone else`)
    return { status: 'skipped', reason: 'not_owner' }
  }
  if (!hasGoogleOAuthConfig()) {
    return skipCalendarSync(input.appointment.id, 'google_oauth_not_configured')
  }

  const loadToken = input.loadToken || loadGoogleOAuthToken
  const token = await loadToken(ownerEmail)
  if (!token) {
    return skipCalendarSync(input.appointment.id, 'no_token')
  }
  if (!hasGoogleScope(token.scope, CALENDAR_SCOPE)) {
    return skipCalendarSync(input.appointment.id, 'missing_calendar')
  }

  const getAccessToken = input.getAccessToken || getValidAccessTokenResult
  const tokenResult = await getAccessToken(token)
  if (!tokenResult.accessToken) {
    return skipCalendarSync(input.appointment.id, tokenResult.error || 'token_refresh_failed')
  }

  const times = appointmentEventTimes(input.appointment.scheduled_at, input.appointment.type)
  const typeLabel = TYPE_LABELS[input.appointment.type || ''] || 'Appointment'
  const leadName = input.leadName?.trim() || 'seller'
  const upsert = await upsertGoogleCalendarEvent({
    accessToken: tokenResult.accessToken,
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
