import { mobileCommandPayloadHash } from '@/lib/mobile-api/command-receipts'
import {
  type MobileAppointment,
  type MobileAppointmentCommandResult,
  type MobileAppointmentProviderSyncStatus,
  type MobileAppointmentStatus,
  type MobileAppointmentType,
} from '@/lib/mobile-api/appointment-contract'
import { queuePpcAppointmentBookedConversion } from '@/lib/ppc/appointment-booked-conversion'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { supabaseAdmin } from '@/lib/supabase/admin'

type AppointmentCommand = 'create' | 'edit' | 'reschedule' | 'outcome'

type AppointmentDbRow = {
  id: string
  lead_id: string
  type: string
  status: string
  scheduled_at: string
  ends_at: string
  title: string
  location: string | null
  address?: string | null
  time_zone: string
  assigned_to: string | null
  notes: string | null
  sequence_enabled?: boolean | null
  version: number
  source: string
  created_at: string
  updated_at: string
  provider_event_id?: string | null
  provider_sync_status?: string | null
  provider_synced_at?: string | null
  provider_sync_error?: string | null
}

type AppointmentRpcResult = {
  created: boolean
  changed: boolean
  replayed: boolean
  appointment: AppointmentDbRow
  activityId?: string | null
}

export class AppointmentCommandError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid' | 'not_found' | 'conflict' | 'unavailable',
  ) {
    super(message)
  }
}

function canonicalType(value: string): MobileAppointmentType {
  if (value === 'in_person' || value === 'onsite') return 'in_person'
  if (value === 'google_meet' || value === 'virtual') return 'google_meet'
  return 'phone_call'
}

function canonicalStatus(value: string): MobileAppointmentStatus {
  if (['scheduled', 'confirmed', 'completed', 'no_show', 'cancelled', 'rescheduled'].includes(value)) {
    return value as MobileAppointmentStatus
  }
  return 'scheduled'
}

function providerStatus(value: string | null | undefined): MobileAppointmentProviderSyncStatus {
  if (value === 'pending' || value === 'synced' || value === 'failed') return value
  return 'not_configured'
}

export function mapMobileAppointment(row: AppointmentDbRow): MobileAppointment {
  const reminders = row.sequence_enabled === true ? 'enabled' : 'disabled'
  return {
    id: row.id,
    leadId: row.lead_id,
    type: canonicalType(row.type),
    status: canonicalStatus(row.status),
    scheduledAt: row.scheduled_at,
    endsAt: row.ends_at,
    title: row.title,
    location: row.location ?? row.address ?? null,
    timeZone: row.time_zone,
    assignedTo: row.assigned_to,
    notes: row.notes,
    sendReminder: reminders === 'enabled',
    version: row.version,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sync: {
      reminders,
      provider: providerStatus(row.provider_sync_status),
      providerEventId: row.provider_event_id ?? null,
      providerSyncedAt: row.provider_synced_at ?? null,
      providerError: row.provider_sync_error ?? null,
    },
  }
}

function commandError(error: { message?: string } | null): AppointmentCommandError {
  const message = error?.message || ''
  if (message.includes('appointment_idempotency_conflict')) {
    return new AppointmentCommandError('That Idempotency-Key belongs to a different appointment command.', 'conflict')
  }
  if (message.includes('appointment_version_conflict')) {
    return new AppointmentCommandError('This appointment changed on another device. Refresh before editing it again.', 'conflict')
  }
  if (message.includes('appointment_not_found')) {
    return new AppointmentCommandError('Appointment not found.', 'not_found')
  }
  if (message.includes('appointment_lead_mismatch')) {
    return new AppointmentCommandError('The appointment does not belong to that contact.', 'conflict')
  }
  if (message.includes('appointment_terminal')) {
    return new AppointmentCommandError('A completed or cancelled appointment cannot be edited.', 'conflict')
  }
  if (message.includes('appointments_mobile_duration_check')) {
    return new AppointmentCommandError('Appointment duration must be between 15 minutes and 24 hours.', 'invalid')
  }
  if (message.includes('appointment_invalid_')) {
    return new AppointmentCommandError('The appointment command contains invalid or unsupported values.', 'invalid')
  }
  return new AppointmentCommandError('Appointment service is temporarily unavailable.', 'unavailable')
}

export async function executeMobileAppointmentCommand(input: {
  actor: { email: string; name: string }
  idempotencyKey: string
  command: AppointmentCommand
  appointmentId?: string | null
  leadId?: string | null
  expectedVersion?: number | null
  payload: Record<string, unknown>
}): Promise<MobileAppointmentCommandResult> {
  const hashInput = {
    command: input.command,
    appointmentId: input.appointmentId ?? null,
    leadId: input.leadId ?? null,
    expectedVersion: input.expectedVersion ?? null,
    payload: input.payload,
  }
  const { data, error } = await supabaseAdmin().rpc('apply_mobile_appointment_command_v1', {
    p_actor_email: input.actor.email,
    p_actor_name: input.actor.name,
    p_idempotency_key: input.idempotencyKey,
    p_command: input.command,
    p_appointment_id: input.appointmentId ?? null,
    p_lead_id: input.leadId ?? null,
    p_expected_version: input.expectedVersion ?? null,
    p_payload_hash: mobileCommandPayloadHash(hashInput),
    p_payload: input.payload,
  })
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw commandError(error)

  const result = data as unknown as AppointmentRpcResult
  if (!result.appointment?.id) throw new AppointmentCommandError('Appointment service returned an invalid record.', 'unavailable')
  const appointment = mapMobileAppointment(result.appointment)
  let lifecycle: MobileAppointmentCommandResult['sideEffects']['lifecycle'] = 'not_applicable'
  let conversion: MobileAppointmentCommandResult['sideEffects']['conversion'] = 'not_applicable'
  const warnings: string[] = []

  if (!result.replayed && (input.command === 'create' || (input.command === 'outcome' && input.payload.outcome === 'completed'))) {
    try {
      const lifecycleResult = await checkAutoAdvance(
        appointment.leadId,
        input.command === 'create' ? 'appointment_set' : 'appointment_completed',
      )
      lifecycle = lifecycleResult.advanced ? 'advanced' : 'unchanged'
    } catch (sideEffectError) {
      console.error('[mobile/appointments] lifecycle refresh failed', sideEffectError)
      lifecycle = 'failed'
      warnings.push('The lifecycle stage refresh is pending.')
    }
  }

  if (!result.replayed && input.command === 'create') {
    try {
      const queued = await queuePpcAppointmentBookedConversion({
        leadId: appointment.leadId,
        appointmentId: appointment.id,
        activityId: result.activityId ?? null,
        scheduledAt: appointment.scheduledAt,
        appointmentType: appointment.type,
        assignedTo: appointment.assignedTo,
        source: 'mobile_app',
      })
      conversion = queued.queued ? 'queued' : 'skipped'
    } catch (sideEffectError) {
      console.error('[mobile/appointments] conversion queue failed', sideEffectError)
      conversion = 'failed'
      warnings.push('The attribution queue refresh is pending.')
    }
  }

  return {
    success: true,
    created: result.created === true,
    changed: result.changed === true,
    replayed: result.replayed === true,
    appointment,
    activityId: result.activityId ?? null,
    sideEffects: {
      lifecycle,
      conversion,
      reminders: appointment.sync.reminders,
      provider: appointment.sync.provider,
    },
    ...(warnings.length ? { warning: `Appointment saved. ${warnings.join(' ')} Do not submit it again.` } : {}),
  }
}

export async function listMobileAppointments(limit = 300): Promise<MobileAppointment[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500)
  const { data, error } = await supabaseAdmin()
    .from('appointments')
    .select('id,lead_id,type,status,scheduled_at,ends_at,title,location,address,time_zone,assigned_to,notes,sequence_enabled,version,source,created_at,updated_at,provider_event_id,provider_sync_status,provider_synced_at,provider_sync_error')
    .in('status', ['scheduled', 'confirmed', 'rescheduled'])
    .order('scheduled_at', { ascending: true })
    .limit(safeLimit)
  if (error) throw new AppointmentCommandError('Appointments are temporarily unavailable.', 'unavailable')
  return (data ?? []).map((row) => mapMobileAppointment(row as AppointmentDbRow))
}
