import { queuePpcAppointmentBookedConversion } from '@/lib/ppc/appointment-booked-conversion'
import { queuePpcQualifiedLeadConversion } from '@/lib/ppc/qualified-lead-conversion'
import { getLeadQualificationStatus } from '@/lib/qualification-policy'
import {
  nextAppointmentDate,
  planAppointmentOutcome,
  stableOutcomeUuid,
  type AppointmentOutcomeRequest,
  type OutcomePlan,
} from '@/lib/server/appointment-outcome-plan'
import { applyCrmLifecycleCommand } from '@/lib/server/crm-lifecycle'
import { createWorkItem, WorkItemError } from '@/lib/server/work-items'
import { supabaseAdmin } from '@/lib/supabase/admin'

const APPOINTMENT_COLUMNS = 'id,lead_id,type,status,scheduled_at,ends_at,title,location,address,time_zone,assigned_to,notes,sequence_enabled,version,source,created_at,updated_at,provider_event_id,provider_sync_status,provider_synced_at,provider_sync_error,confirmation_status,no_show_risk,no_show_risk_at,reschedule_requested_at'

const OUTCOME_LABELS = {
  completed: 'Appointment completed',
  no_show: 'Appointment no-show',
  cancelled: 'Appointment cancelled',
  rescheduled: 'Appointment rescheduled',
} as const

type AppointmentRow = {
  id: string
  lead_id: string | null
  type: string
  status: string
  scheduled_at: string
  ends_at: string | null
  title: string | null
  location: string | null
  address: string | null
  time_zone: string | null
  assigned_to: string | null
  notes: string | null
  sequence_enabled: boolean | null
  version: number
  source: string
  created_at: string
  updated_at: string
  provider_event_id: string | null
  provider_sync_status: string | null
  provider_synced_at: string | null
  provider_sync_error: string | null
  confirmation_status?: string | null
  no_show_risk?: boolean | null
  no_show_risk_at?: string | null
  reschedule_requested_at?: string | null
}

export class AppointmentOutcomeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 500,
    readonly code: 'invalid' | 'not_found' | 'conflict' | 'timeline_failed' | 'stage_failed' | 'task_failed' | 'save_failed' | 'snapshot_failed',
  ) {
    super(message)
    this.name = 'AppointmentOutcomeError'
  }
}

export type RecordAppointmentOutcomeResult = {
  success: true
  appointmentId: string
  outcome: OutcomePlan['status']
  appointment: AppointmentRow
  stage: { from: string | null; to: string | null; changed: boolean; exception: boolean }
  appointmentDate: string | null
  followUpTaskKey: string | null
  replacementAppointmentId: string | null
  replayed: boolean
}

function duplicate(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '23505' || /duplicate key/i.test(error.message ?? '')
}

function failure(error: { message?: string } | null, fallback: string): string {
  return error?.message || fallback
}

export async function recordAppointmentOutcome(input: {
  actor: { email: string; name: string }
  source: 'appointment_outcome_review' | 'mobile_app'
  request: AppointmentOutcomeRequest
  now?: Date
}): Promise<RecordAppointmentOutcomeResult> {
  const now = input.now ?? new Date()
  const db = supabaseAdmin()
  const request = input.request
  if (!request.leadId && !request.appointmentId) {
    throw new AppointmentOutcomeError('A valid contact and outcome are required', 400, 'invalid')
  }

  let appointmentQuery = db.from('appointments').select(APPOINTMENT_COLUMNS)
  if (request.appointmentId) {
    appointmentQuery = appointmentQuery.eq('id', request.appointmentId)
    if (request.leadId) appointmentQuery = appointmentQuery.eq('lead_id', request.leadId)
  } else if (request.leadId) {
    appointmentQuery = appointmentQuery
      .eq('lead_id', request.leadId)
      .in('status', ['scheduled', 'confirmed', 'rescheduled'])
      .order('scheduled_at', { ascending: false })
      .limit(1)
  }
  const { data: loaded, error: loadError } = await appointmentQuery.maybeSingle()
  if (loadError) throw new AppointmentOutcomeError('Appointment could not be loaded', 500, 'save_failed')
  if (!loaded) throw new AppointmentOutcomeError('Appointment not found', 404, 'not_found')
  const appointment = loaded as AppointmentRow

  if (request.expectedVersion != null && request.expectedVersion !== appointment.version && appointment.status !== request.outcome) {
    throw new AppointmentOutcomeError('This appointment changed on another device. Refresh before logging the outcome again.', 409, 'conflict')
  }

  const leadId = appointment.lead_id
  let currentStage: string | null = null
  let qualified = false
  if (leadId) {
    const { data: lead, error: leadError } = await db.from('leads').select('id,station').eq('id', leadId).maybeSingle()
    if (leadError) throw new AppointmentOutcomeError('Contact could not be loaded', 500, 'save_failed')
    if (!lead) throw new AppointmentOutcomeError('Contact not found', 404, 'not_found')
    currentStage = typeof lead.station === 'string' && lead.station ? lead.station : 'new'
    try {
      qualified = (await getLeadQualificationStatus(leadId)).qualified
    } catch (error) {
      throw new AppointmentOutcomeError(error instanceof Error ? error.message : 'Qualification records could not be read.', 500, 'save_failed')
    }
  }

  const planned = planAppointmentOutcome({
    request,
    currentStage: currentStage ?? 'new',
    qualified,
    appointmentStatus: appointment.status,
    now,
  })
  if (!planned.ok) throw new AppointmentOutcomeError(planned.error, planned.status, planned.status === 409 ? 'conflict' : 'invalid')
  const plan = planned.plan

  let saved = appointment
  if (!planned.continuation) {
    const nowIso = now.toISOString()
    const patch: Record<string, unknown> = {
      status: plan.status,
      updated_at: nowIso,
      version: Number(appointment.version) + 1,
      sequence_enabled: false,
    }
    if (request.notes) patch.notes = request.notes
    if (plan.status === 'rescheduled') patch.reschedule_requested_at = nowIso
    if (appointment.provider_event_id) {
      patch.provider_sync_status = 'pending'
      patch.provider_sync_error = null
    }
    const { data: updated, error: updateError } = await db
      .from('appointments')
      .update(patch)
      .eq('id', appointment.id)
      .eq('version', appointment.version)
      .select(APPOINTMENT_COLUMNS)
      .maybeSingle()
    if (updateError) throw new AppointmentOutcomeError(failure(updateError, 'Appointment outcome could not be saved'), 500, 'save_failed')
    if (!updated) {
      throw new AppointmentOutcomeError('This appointment changed on another device. Refresh before logging the outcome again.', 409, 'conflict')
    }
    saved = updated as AppointmentRow
  }

  let replacementAppointmentId: string | null = null
  if (leadId && plan.replacementAppointment) {
    replacementAppointmentId = await saveReplacementAppointment({
      leadId,
      appointment: saved,
      plan,
    })
  }

  if (leadId) {
    const activityId = stableOutcomeUuid(`appointment-outcome-activity:${saved.id}:${plan.status}`)
    const { error: activityError } = await db.from('lead_activities').insert({
      id: activityId,
      lead_id: leadId,
      activity_type: 'appointment_outcome',
      description: OUTCOME_LABELS[plan.status] + (request.notes ? `: ${request.notes}` : ''),
      agent: input.actor.name,
      metadata: {
        appointment_id: saved.id,
        outcome: plan.status,
        confirmation_status: appointment.confirmation_status ?? null,
        no_show_risk: appointment.no_show_risk ?? null,
        no_show_risk_at: appointment.no_show_risk_at ?? null,
        notes: request.notes,
        recorded_at: now.toISOString(),
        actor_email: input.actor.email,
        source: input.source,
        appointment_version: saved.version,
        stage: plan.stage,
        backward_exception: plan.backwardException,
        replacement_appointment_id: replacementAppointmentId,
      },
    })
    if (activityError && !duplicate(activityError)) {
      throw new AppointmentOutcomeError('The appointment outcome timeline entry failed. The outcome was not completed.', 500, 'timeline_failed')
    }
  }

  const appointmentDate = leadId
    ? await refreshAppointmentDate({
      leadId,
      closedAppointmentId: saved.id,
      replacement: plan.replacementAppointment && replacementAppointmentId
        ? {
          id: replacementAppointmentId,
          scheduled_at: plan.replacementAppointment.scheduledAt,
          notes: plan.replacementAppointment.notes,
          status: 'scheduled',
        }
        : null,
      now,
    })
    : null

  let stageResult: RecordAppointmentOutcomeResult['stage'] = {
    from: currentStage,
    to: currentStage,
    changed: false,
    exception: false,
  }
  if (leadId && plan.stage && plan.stage !== currentStage) {
    try {
      const lifecycle = await applyCrmLifecycleCommand({
        leadId,
        commandId: stableOutcomeUuid(`appointment-outcome-stage:${saved.id}:${plan.status}:${plan.stage}`),
        commandType: 'transition',
        stage: plan.stage,
        owner: null,
        deadReason: plan.deadReason,
        deadReasonNotes: plan.deadReasonNotes,
        reason: plan.reason,
        evidenceType: null,
        evidenceReference: null,
        actorEmail: input.actor.email,
        actorName: input.actor.name,
      })
      stageResult = {
        from: lifecycle.fromStage ?? currentStage,
        to: lifecycle.stage,
        changed: true,
        exception: plan.backwardException,
      }
    } catch (error) {
      console.error('[appointment-outcome] stage move failed', error)
      throw new AppointmentOutcomeError('The lead stage could not be moved. The outcome was not completed.', 500, 'stage_failed')
    }

    await queuePpcQualifiedLeadConversion({
      leadId,
      fromStation: stageResult.from,
      toStation: stageResult.to,
      changedBy: input.actor.name,
      reason: plan.reason,
    }).catch((error) => console.error('[appointment-outcome] qualified conversion queue failed', error))

    if (plan.stage === 'appointment_set' && replacementAppointmentId) {
      await queuePpcAppointmentBookedConversion({
        leadId,
        appointmentId: replacementAppointmentId,
        scheduledAt: plan.replacementAppointment?.scheduledAt,
        appointmentType: plan.replacementAppointment?.type ?? saved.type,
        assignedTo: saved.assigned_to,
        source: input.source,
      }).catch((error) => console.error('[appointment-outcome] appointment conversion queue failed', error))
    }
  }

  let followUpTaskKey: string | null = null
  if (leadId && plan.followUp) {
    try {
      const created = await createWorkItem({
        actor: input.actor.name,
        idempotencyKey: `appt-outcome:${saved.id}:${plan.status}`,
        leadId,
        kind: 'follow_up',
        title: plan.followUp.title,
        notes: plan.followUp.notes,
        dueAt: plan.followUp.dueAt,
        assignedTo: saved.assigned_to?.trim() || input.actor.name,
        department: 'acquisitions',
        role: 'setter',
        priority: plan.status === 'rescheduled' ? 'urgent' : 'normal',
        provenance: {
          workflow_id: 'appointment-outcome',
          appointment_id: saved.id,
          outcome: plan.status,
          source: input.source,
        },
      })
      followUpTaskKey = created.workItem.key
    } catch (error) {
      console.error('[appointment-outcome] follow-up task failed', error)
      const message = error instanceof WorkItemError ? error.message : 'The follow-up task could not be saved. The outcome was not completed.'
      throw new AppointmentOutcomeError(message, 500, 'task_failed')
    }
  }

  return {
    success: true,
    appointmentId: saved.id,
    outcome: plan.status,
    appointment: saved,
    stage: stageResult,
    appointmentDate,
    followUpTaskKey,
    replacementAppointmentId,
    replayed: planned.continuation,
  }
}

async function saveReplacementAppointment(input: {
  leadId: string
  appointment: AppointmentRow
  plan: OutcomePlan
}): Promise<string> {
  const replacement = input.plan.replacementAppointment
  if (!replacement) throw new AppointmentOutcomeError('The new appointment time is not valid.', 400, 'invalid')
  const id = stableOutcomeUuid(`appointment-outcome-replacement:${input.appointment.id}`)
  const start = Date.parse(replacement.scheduledAt)
  const endsAt = replacement.endsAt ?? new Date(start + 45 * 60 * 1000).toISOString()
  const db = supabaseAdmin()
  const { error } = await db.from('appointments').insert({
    id,
    lead_id: input.leadId,
    scheduled_at: replacement.scheduledAt,
    ends_at: endsAt,
    type: replacement.type ?? input.appointment.type ?? 'phone_call',
    status: 'scheduled',
    title: replacement.title ?? input.appointment.title ?? 'Rescheduled appointment',
    location: replacement.location ?? input.appointment.location,
    address: replacement.location ?? input.appointment.address,
    time_zone: replacement.timeZone ?? input.appointment.time_zone ?? 'America/Chicago',
    notes: replacement.notes ?? input.appointment.notes,
    assigned_to: input.appointment.assigned_to,
    source: 'manual',
    sequence_enabled: false,
    version: 1,
  })
  if (error && !duplicate(error)) {
    throw new AppointmentOutcomeError('The new appointment could not be saved. The outcome was not completed.', 500, 'save_failed')
  }
  return id
}

async function refreshAppointmentDate(input: {
  leadId: string
  closedAppointmentId: string
  replacement: { id: string; scheduled_at: string; notes: string | null; status: string } | null
  now: Date
}): Promise<string | null> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('appointments')
    .select('id,scheduled_at,notes,status')
    .eq('lead_id', input.leadId)
  if (error) throw new AppointmentOutcomeError('The contact appointment date could not be refreshed. The outcome was not completed.', 500, 'snapshot_failed')
  const rows = Array.isArray(data) ? [...data] : []
  if (input.replacement && !rows.some((row) => row.id === input.replacement?.id)) rows.push(input.replacement)
  const snapshot = nextAppointmentDate(rows, input.now.getTime(), [input.closedAppointmentId])
  const { error: updateError } = await db.from('leads').update({
    appointment_date: snapshot.appointment_date,
    appointment_notes: snapshot.appointment_notes,
    updated_at: input.now.toISOString(),
  }).eq('id', input.leadId)
  if (updateError) {
    throw new AppointmentOutcomeError('The contact appointment date could not be refreshed. The outcome was not completed.', 500, 'snapshot_failed')
  }
  return snapshot.appointment_date
}
