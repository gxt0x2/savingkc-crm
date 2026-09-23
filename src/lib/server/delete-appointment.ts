import { googleCalendarDeleteWarning, deleteOwnedAppointmentGoogleEvent, type AppointmentCalendarSyncResult } from '@/lib/google-calendar'
import { applyCrmLifecycleCommand } from '@/lib/server/crm-lifecycle'
import { supabaseAdmin } from '@/lib/supabase/admin'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UPCOMING_STATUSES = new Set(['scheduled', 'confirmed', 'rescheduled'])
const CLOSED_ACTIVITY_STATUSES = new Set([
  'completed', 'complete', 'done', 'cancelled', 'canceled', 'dismissed', 'waived',
])

export const APPOINTMENT_DELETE_ROLLBACK_STAGE = 'contacted' as const

export type AppointmentDeleteRow = {
  id: string
  lead_id: string
  status: string
  scheduled_at: string
  notes: string | null
  assigned_to: string | null
  google_event_id: string | null
}

export type DeleteAppointmentCommand =
  | { ok: true; leadId: string; appointmentId: string | null; scheduledAt: string | null }
  | { ok: false; error: string; status: 400 }

export type DeleteCrmAppointmentResult =
  | {
      ok: true
      appointmentId: string | null
      deleted: boolean
      rolledBack: boolean
      station: string | null
      googleCalendar: AppointmentCalendarSyncResult
      warnings: string[]
    }
  | { ok: false; error: string; status: 400 | 404 | 500 }

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  return cleaned ? cleaned.slice(0, maxLength) : null
}

export function readDeleteAppointmentCommand(input: unknown): DeleteAppointmentCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Appointment delete command required', status: 400 }
  }
  const body = input as Record<string, unknown>
  const leadId = cleanText(body.leadId, 100)
  const appointmentId = cleanText(body.appointmentId, 100)
  const scheduledAt = cleanText(body.scheduledAt, 100)
  if (!leadId || !UUID_PATTERN.test(leadId)) {
    return { ok: false, error: 'A valid contact is required', status: 400 }
  }
  if (appointmentId && !UUID_PATTERN.test(appointmentId)) {
    return { ok: false, error: 'Invalid appointment identifier', status: 400 }
  }
  if (scheduledAt && !Number.isFinite(Date.parse(scheduledAt))) {
    return { ok: false, error: 'Invalid appointment time', status: 400 }
  }
  return { ok: true, leadId, appointmentId, scheduledAt }
}

export function appointmentDeleteRollbackStage(
  station: string | null | undefined,
  remainingNonCancelled: number,
): typeof APPOINTMENT_DELETE_ROLLBACK_STAGE | null {
  if (station === 'appointment_set' && remainingNonCancelled === 0) return APPOINTMENT_DELETE_ROLLBACK_STAGE
  return null
}

export function selectLeadAppointmentSnapshot(
  rows: Array<{ scheduled_at: string; notes?: string | null; status: string }>,
  now = Date.now(),
): { appointment_date: string | null; appointment_notes: string | null } {
  const upcoming = rows
    .filter((row) => UPCOMING_STATUSES.has(row.status) && Number.isFinite(Date.parse(row.scheduled_at)))
    .sort((left, right) => Date.parse(left.scheduled_at) - Date.parse(right.scheduled_at))
  const future = upcoming.find((row) => Date.parse(row.scheduled_at) >= now)
  const chosen = future ?? upcoming.at(-1) ?? null
  if (!chosen) return { appointment_date: null, appointment_notes: null }
  return { appointment_date: chosen.scheduled_at, appointment_notes: chosen.notes ?? null }
}

export function sameAppointmentInstant(left: string, right: string): boolean {
  const leftMs = Date.parse(left)
  const rightMs = Date.parse(right)
  return Number.isFinite(leftMs) && leftMs === rightMs
}

export function chooseAppointmentToDelete(input: {
  rows: AppointmentDeleteRow[]
  appointmentId?: string | null
  scheduledAt?: string | null
}): { ok: true; appointment: AppointmentDeleteRow | null } | { ok: false; error: string; status: 400 | 404 } {
  if (input.appointmentId) {
    const match = input.rows.find((row) => row.id === input.appointmentId)
    if (!match) return { ok: false, error: 'Appointment not found', status: 404 }
    return { ok: true, appointment: match }
  }
  const nonCancelled = input.rows.filter((row) => row.status !== 'cancelled')
  const pool = nonCancelled.length > 0 ? nonCancelled : input.rows
  if (input.scheduledAt) {
    const matches = pool.filter((row) => sameAppointmentInstant(row.scheduled_at, input.scheduledAt || ''))
    if (matches.length === 1) return { ok: true, appointment: matches[0] }
    if (matches.length > 1) {
      return { ok: false, error: 'More than one appointment matches that time.', status: 400 }
    }
  }
  if (pool.length === 1) return { ok: true, appointment: pool[0] }
  if (pool.length === 0) return { ok: true, appointment: null }
  return {
    ok: false,
    error: 'More than one appointment is on this contact. Open that appointment and delete it.',
    status: 400,
  }
}

export function shouldCloseActivityForDeletedAppointment(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return true
  const status = typeof (metadata as { status?: unknown }).status === 'string'
    ? (metadata as { status: string }).status.trim().toLowerCase()
    : 'pending'
  return !CLOSED_ACTIVITY_STATUSES.has(status)
}

function closedActivityMetadata(metadata: unknown): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {}
  return { ...base, status: 'dismissed', resolution: 'appointment_deleted' }
}

function asAppointmentRow(value: unknown): AppointmentDeleteRow | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.scheduled_at !== 'string') return null
  return {
    id: row.id,
    lead_id: typeof row.lead_id === 'string' ? row.lead_id : '',
    status: typeof row.status === 'string' ? row.status : 'scheduled',
    scheduled_at: row.scheduled_at,
    notes: typeof row.notes === 'string' ? row.notes : null,
    assigned_to: typeof row.assigned_to === 'string' ? row.assigned_to : null,
    google_event_id: typeof row.google_event_id === 'string' ? row.google_event_id : null,
  }
}

export async function deleteCrmAppointment(input: {
  leadId: string
  appointmentId?: string | null
  scheduledAt?: string | null
  actor: { email: string; name: string }
  now?: number
  deleteGoogleEvent?: typeof deleteOwnedAppointmentGoogleEvent
}): Promise<DeleteCrmAppointmentResult> {
  const db = supabaseAdmin()
  const now = input.now ?? Date.now()
  const { data: lead, error: leadError } = await db
    .from('leads')
    .select('station')
    .eq('id', input.leadId)
    .maybeSingle()
  if (leadError) return { ok: false, error: 'Contact could not be loaded', status: 500 }
  if (!lead) return { ok: false, error: 'Contact not found', status: 404 }
  const station = typeof lead.station === 'string' ? lead.station : null

  const { data: appointmentRows, error: listError } = await db
    .from('appointments')
    .select('id, lead_id, status, scheduled_at, notes, assigned_to, google_event_id')
    .eq('lead_id', input.leadId)
  if (listError) return { ok: false, error: 'Appointment could not be loaded', status: 500 }
  const rows = (appointmentRows ?? []).flatMap((row) => {
    const appointment = asAppointmentRow(row)
    return appointment ? [appointment] : []
  })
  const chosen = chooseAppointmentToDelete({
    rows,
    appointmentId: input.appointmentId,
    scheduledAt: input.scheduledAt,
  })
  if (!chosen.ok) return chosen
  if (!chosen.appointment && station !== 'appointment_set') {
    return { ok: false, error: 'Appointment not found', status: 404 }
  }

  const warnings: string[] = []
  let googleCalendar: AppointmentCalendarSyncResult = { status: 'skipped', reason: 'no_event' }
  if (chosen.appointment) {
    const deletedAppointment = chosen.appointment
    const { error: deleteError } = await db
      .from('appointments')
      .delete()
      .eq('id', deletedAppointment.id)
      .eq('lead_id', input.leadId)
    if (deleteError) {
      console.error('[delete-appointment] appointment delete failed:', deleteError)
      return { ok: false, error: 'Appointment could not be deleted', status: 500 }
    }

    const deleteGoogleEvent = input.deleteGoogleEvent || deleteOwnedAppointmentGoogleEvent
    googleCalendar = await deleteGoogleEvent({
      actorEmail: input.actor.email,
      assignedTo: deletedAppointment.assigned_to,
      appointment: {
        id: deletedAppointment.id,
        google_event_id: deletedAppointment.google_event_id,
      },
    }).catch((error) => {
      console.warn(`[delete-appointment] Google Calendar delete failed for ${deletedAppointment.id}:`, error)
      return { status: 'skipped' as const, reason: 'calendar_delete_failed' }
    })
    const calendarWarning = googleCalendarDeleteWarning(googleCalendar, Boolean(deletedAppointment.google_event_id))
    if (calendarWarning) {
      console.warn(`[delete-appointment] Google Calendar delete failed for ${deletedAppointment.id}: ${googleCalendar.status === 'skipped' ? googleCalendar.reason : 'unknown'}`)
      warnings.push(calendarWarning)
    }
  }

  const remaining = rows.filter((row) => row.id !== chosen.appointment?.id && row.status !== 'cancelled')
  const snapshot = selectLeadAppointmentSnapshot(remaining, now)
  const { error: snapshotError } = await db
    .from('leads')
    .update({
      appointment_date: snapshot.appointment_date,
      appointment_notes: snapshot.appointment_notes,
      updated_at: new Date(now).toISOString(),
    })
    .eq('id', input.leadId)
  if (snapshotError) {
    console.error('[delete-appointment] contact snapshot refresh failed:', snapshotError)
    warnings.push('The contact appointment snapshot could not be refreshed.')
  }

  if (chosen.appointment) {
    const { data: activities, error: activityLoadError } = await db
      .from('lead_activities')
      .select('id, metadata')
      .eq('lead_id', input.leadId)
      .contains('metadata', { appointment_id: chosen.appointment.id })
    if (activityLoadError) {
      console.error('[delete-appointment] related activity lookup failed:', activityLoadError)
      warnings.push('Open appointment tasks could not be closed.')
    } else {
      const closable = (activities ?? []).filter((activity) => shouldCloseActivityForDeletedAppointment(activity.metadata))
      const closures = await Promise.all(closable.map(async (activity) => {
        const { error } = await db
          .from('lead_activities')
          .update({ metadata: closedActivityMetadata(activity.metadata) })
          .eq('id', activity.id)
          .eq('lead_id', input.leadId)
        return error
      }))
      if (closures.some(Boolean)) warnings.push('Open appointment tasks could not be closed.')
    }

    const { error: timelineError } = await db.from('lead_activities').insert({
      lead_id: input.leadId,
      activity_type: 'appointment_outcome',
      description: 'Appointment deleted',
      agent: input.actor.name,
      metadata: {
        appointment_id: chosen.appointment.id,
        outcome: 'deleted',
        status: 'dismissed',
        resolution: 'appointment_deleted',
        scheduled_at: chosen.appointment.scheduled_at,
        actor_email: input.actor.email,
        source: 'appointment_delete',
      },
    })
    if (timelineError) warnings.push('The appointment timeline entry is pending.')
  }

  const rollbackStage = appointmentDeleteRollbackStage(station, remaining.length)
  let nextStation = station
  let rolledBack = false
  if (rollbackStage) {
    try {
      const lifecycle = await applyCrmLifecycleCommand({
        leadId: input.leadId,
        commandId: crypto.randomUUID(),
        commandType: 'transition',
        stage: rollbackStage,
        owner: null,
        deadReason: null,
        deadReasonNotes: null,
        reason: 'Appointment deleted',
        evidenceType: null,
        evidenceReference: null,
        actorEmail: input.actor.email,
        actorName: input.actor.name,
      })
      nextStation = lifecycle.stage
      rolledBack = true
    } catch (error) {
      console.error('[delete-appointment] lifecycle rollback failed:', error)
      warnings.push('The appointment was removed, but the pipeline stage could not be moved back to Contacted.')
    }
  }

  return {
    ok: true,
    appointmentId: chosen.appointment?.id ?? null,
    deleted: Boolean(chosen.appointment),
    rolledBack,
    station: nextStation,
    googleCalendar,
    warnings,
  }
}
