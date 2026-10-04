import { randomUUID } from 'node:crypto'
import { resolveAppointmentCalendarAccess } from '@/lib/google-calendar'
import { supabaseAdmin } from '@/lib/supabase/admin'

type AppointmentSnapshot = {
  id: string
  version: number
  title: string
  scheduled_at: string
  ends_at: string
  time_zone: string
  location: string | null
  status: string
}

type CalendarClaim =
  | { status: 'claimed'; ownerEmail: string; eventId: string; version: number; appointment: AppointmentSnapshot }
  | { status: 'synced' | 'busy' | 'review_required' | 'not_owner' | 'no_owner' | 'not_found' | 'version_conflict' }

type GoogleEvent = {
  id?: string
  etag?: string
  extendedProperties?: { private?: Record<string, string> }
}

export type MobileCalendarSyncOutcome = {
  status: 'synced' | 'pending' | 'failed' | 'not_configured'
  warning?: string
  reason?: string | null
}

const MISSING_CALENDAR_GRANT = new Set(['no_token', 'missing_calendar', 'google_oauth_not_configured'])

export class MissingCalendarGrantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingCalendarGrantError'
  }
}

export function missingCalendarGrant(reason: string | null | undefined): boolean {
  return MISSING_CALENDAR_GRANT.has(reason ?? '')
}

/** A missing Google calendar grant fails the command. It is not a saved not_configured sync. */
export async function assertActorCalendarGrant(actorEmail: string, action: 'save' | 'cancel'): Promise<void> {
  const access = await resolveAppointmentCalendarAccess({
    actorEmail,
    appointmentId: 'mobile-calendar-grant',
  })
  if (access.ok || !missingCalendarGrant(access.result.reason)) return
  throw new MissingCalendarGrantError(action === 'cancel'
    ? 'Google Calendar is not connected, so this cancel cannot reach Google. The appointment was not cancelled.'
    : 'Google Calendar is not connected for this account. Connect Google before saving. This item was not saved.')
}

export class MobileCalendarRetryError extends Error {
  constructor(message: string, readonly status: 403 | 404 | 409) { super(message) }
}

const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const GOOGLE_TIMEOUT_MS = 15_000

function eventUrl(eventId: string): string {
  return `${EVENTS}/${encodeURIComponent(eventId)}`
}

function eventMatches(event: GoogleEvent, appointmentId: string, ownerEmail: string): boolean {
  const marker = event.extendedProperties?.private
  return marker?.savingkcMobileAppointmentId === appointmentId
    && marker?.savingkcCalendarOwner === ownerEmail
}

function remoteVersion(event: GoogleEvent): number {
  const value = Number(event.extendedProperties?.private?.savingkcMobileAppointmentVersion)
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

function eventBody(appointment: AppointmentSnapshot, ownerEmail: string, eventId: string): Record<string, unknown> {
  return {
    id: eventId,
    summary: appointment.title,
    location: appointment.location || undefined,
    start: { dateTime: appointment.scheduled_at, timeZone: appointment.time_zone },
    end: { dateTime: appointment.ends_at, timeZone: appointment.time_zone },
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: {
      private: {
        savingkcMobileAppointmentId: appointment.id,
        savingkcMobileAppointmentVersion: String(appointment.version),
        savingkcCalendarOwner: ownerEmail,
      },
    },
  }
}

type RemoteSyncResult = { ok: true } | { ok: false; reason: string; mutationAttempted?: true }

/** A deterministic id plus private marker makes an ambiguous POST retry discoverable. */
export async function syncMobileAppointmentGoogleEvent(input: {
  appointment: AppointmentSnapshot
  ownerEmail: string
  eventId: string
  accessToken: string
  fetchImpl?: typeof fetch
}): Promise<RemoteSyncResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.accessToken}`,
    'Content-Type': 'application/json',
  }
  let mutationStarted = false
  const request = async (url: string, init: RequestInit): Promise<Response> => {
    if (init.method && init.method !== 'GET') mutationStarted = true
    return fetchImpl(url, { ...init, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) })
  }
  try {
  const url = eventUrl(input.eventId)
  const existingResponse = await request(url, { method: 'GET', headers })
  if (existingResponse.status === 410 && input.appointment.status === 'cancelled') return { ok: true }
  if (existingResponse.status !== 404 && !existingResponse.ok) {
    return { ok: false, reason: `calendar_get_${existingResponse.status}` }
  }
  const existing = existingResponse.ok ? await existingResponse.json() as GoogleEvent : null
  if (existing && (!eventMatches(existing, input.appointment.id, input.ownerEmail) || existing.id !== input.eventId)) {
    return { ok: false, reason: 'calendar_event_identity_conflict' }
  }
  if (existing && remoteVersion(existing) > input.appointment.version) {
    return { ok: false, reason: 'calendar_newer_event_conflict' }
  }

  if (input.appointment.status === 'cancelled') {
    if (!existing) return { ok: true }
    if (!existing.etag) return { ok: false, reason: 'calendar_missing_etag' }
    const deleted = await request(`${url}?sendUpdates=none`, {
      method: 'DELETE', headers: { ...headers, 'If-Match': existing.etag },
    })
    return deleted.ok || deleted.status === 404 || deleted.status === 410
      ? { ok: true }
      : { ok: false, reason: `calendar_delete_${deleted.status}`, mutationAttempted: true }
  }

  if (existing && remoteVersion(existing) === input.appointment.version) return { ok: true }
  const body = JSON.stringify(eventBody(input.appointment, input.ownerEmail, input.eventId))
  if (existing) {
    if (!existing.etag) return { ok: false, reason: 'calendar_missing_etag' }
    const updated = await request(`${url}?sendUpdates=none`, {
      method: 'PUT', headers: { ...headers, 'If-Match': existing.etag }, body,
    })
    if (!updated.ok) return { ok: false, reason: `calendar_update_${updated.status}`, mutationAttempted: true }
    const event = await updated.json() as GoogleEvent
    return event.id === input.eventId
      && eventMatches(event, input.appointment.id, input.ownerEmail)
      && remoteVersion(event) === input.appointment.version
      ? { ok: true }
      : { ok: false, reason: 'calendar_update_identity_conflict', mutationAttempted: true }
  }
  const created = await request(`${EVENTS}?sendUpdates=none`, { method: 'POST', headers, body })
  if (created.ok) {
    const event = await created.json() as GoogleEvent
    return event.id === input.eventId
      && eventMatches(event, input.appointment.id, input.ownerEmail)
      && remoteVersion(event) === input.appointment.version
      ? { ok: true }
      : { ok: false, reason: 'calendar_create_identity_conflict', mutationAttempted: true }
  }
  if (created.status === 409) {
    const retry = await request(url, { method: 'GET', headers })
    if (!retry.ok) return { ok: false, reason: `calendar_collision_get_${retry.status}`, mutationAttempted: true }
    const event = await retry.json() as GoogleEvent
    return event.id === input.eventId
      && eventMatches(event, input.appointment.id, input.ownerEmail)
      && remoteVersion(event) === input.appointment.version
      ? { ok: true }
      : { ok: false, reason: 'calendar_event_identity_conflict', mutationAttempted: true }
  }
  return { ok: false, reason: `calendar_create_${created.status}`, mutationAttempted: true }
  } catch {
    return mutationStarted
      ? { ok: false, reason: 'calendar_request_failed', mutationAttempted: true }
      : { ok: false, reason: 'calendar_request_failed' }
  }
}

/** Provider failure never rolls back the already-committed CRM appointment. */
export async function syncMobileAppointmentCalendar(input: {
  appointmentId: string
  actorEmail: string
  expectedVersion?: number
  requireOwner?: boolean
}): Promise<MobileCalendarSyncOutcome> {
  const token = randomUUID()
  const { data, error } = await supabaseAdmin().rpc('claim_mobile_appointment_calendar_sync_v1', {
    p_appointment_id: input.appointmentId,
    p_actor_email: input.actorEmail,
    p_claim_token: token,
    p_expected_version: input.expectedVersion ?? null,
  })
  if (error || !data || typeof data !== 'object') {
    console.error('[mobile/appointments] calendar claim failed', error)
    return { status: 'pending', warning: 'Google Calendar sync could not be started.' }
  }
  const claim = data as CalendarClaim
  if (claim.status === 'synced') return { status: 'synced' }
  if (claim.status === 'busy') return { status: 'pending', warning: 'Google Calendar sync is already in progress.' }
  if (claim.status === 'review_required') {
    return { status: 'pending', warning: 'Google Calendar sync needs review before another retry. The prior write may have reached Google.' }
  }
  if (claim.status === 'version_conflict') {
    throw new MobileCalendarRetryError('This appointment changed on another device. Refresh before retrying calendar sync.', 409)
  }
  if (claim.status === 'not_owner') {
    if (input.requireOwner) throw new MobileCalendarRetryError('Only the original calendar owner can retry sync.', 403)
    return { status: 'pending', warning: 'Only the original calendar owner can sync this appointment. The CRM change was saved.' }
  }
  if (claim.status !== 'claimed') {
    if (input.requireOwner) throw new MobileCalendarRetryError('This appointment has no calendar owner.', claim.status === 'not_found' ? 404 : 409)
    return { status: 'not_configured', warning: 'This appointment has no connected calendar owner.' }
  }

  let status: 'synced' | 'failed' | 'not_configured' = 'failed'
  let reason: string | null = null
  try {
    const access = await resolveAppointmentCalendarAccess({
      actorEmail: claim.ownerEmail,
      appointmentId: input.appointmentId,
    })
    if (!access.ok) {
      status = access.result.reason === 'no_token' || access.result.reason === 'missing_calendar'
        || access.result.reason === 'google_oauth_not_configured'
        ? 'not_configured' : 'failed'
      reason = access.result.reason
    } else {
      const remote = await syncMobileAppointmentGoogleEvent({
        appointment: claim.appointment,
        ownerEmail: claim.ownerEmail,
        eventId: claim.eventId,
        accessToken: access.accessToken,
      })
      if (!remote.ok && remote.mutationAttempted) {
        // A provider write may have succeeded despite an error or timeout.
        // Keep the claim so a later request cannot race this possibly paused writer.
        return { status: 'pending', warning: 'Google Calendar sync needs review. A prior write may have reached Google.' }
      }
      status = remote.ok ? 'synced' : 'failed'
      reason = remote.ok ? null : remote.reason
    }
  } catch (cause) {
    console.error('[mobile/appointments] Google Calendar sync failed', cause)
    status = 'failed'
    reason = 'calendar_request_failed'
  }

  const finished = await supabaseAdmin().rpc('finish_mobile_appointment_calendar_sync_v1', {
    p_appointment_id: input.appointmentId,
    p_claim_token: token,
    p_status: status,
    p_error: reason,
  })
  if (finished.error || !finished.data || typeof finished.data !== 'object') {
    console.error('[mobile/appointments] calendar finish failed', finished.error)
    return { status: 'pending', warning: 'Google Calendar sync is pending confirmation.' }
  }
  const finishStatus = (finished.data as { status?: string }).status
  if (finishStatus === 'superseded' || finishStatus === 'stale_claim') {
    return { status: 'pending', warning: 'A newer appointment version needs Google Calendar sync.' }
  }
  if (finishStatus !== status) {
    return { status: 'pending', warning: 'Google Calendar sync is pending confirmation.' }
  }
  if (status === 'synced') return { status }
  if (status === 'not_configured') {
    return { status, reason, warning: 'Google Calendar is not connected for the original appointment owner.' }
  }
  return { status: 'failed', warning: 'The appointment was saved, but Google Calendar was not updated.' }
}
