import { upsertAppointmentFromCall } from '@/lib/appointments'
import { EAGER_REGEN_EVENTS, regenerateBriefing } from '@/lib/briefing-regen'
import { normalizeDisposition, type DispositionId } from '@/lib/dialer-dispositions'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { queuePpcAppointmentBookedConversion } from '@/lib/ppc/appointment-booked-conversion'
import { supabase } from '@/lib/supabase-lazy'

export interface LeadDispositionCommand {
  disposition: DispositionId
  notes: string | null
  phone: string | null
  appointmentAt: string | null
  clientAttemptId: string | null
}

export type LeadDispositionCommandResult =
  | { ok: true; command: LeadDispositionCommand }
  | { ok: false; error: string; code?: string }

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  return cleaned ? cleaned.slice(0, maxLength) : null
}

export function buildLeadDispositionCommand(input: unknown, now = Date.now()): LeadDispositionCommandResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Disposition command required' }
  }
  const body = input as Record<string, unknown>
  const disposition = normalizeDisposition(typeof body.disposition === 'string' ? body.disposition : null)
  if (!disposition) return { ok: false, error: 'Choose a valid call outcome' }

  const appointmentAtText = cleanText(body.appointmentAt, 100)
  let appointmentAt: string | null = null
  if (disposition === 'appointment_set') {
    const appointmentMs = appointmentAtText ? new Date(appointmentAtText).getTime() : Number.NaN
    const latestAllowed = now + (2 * 365 * 24 * 60 * 60 * 1000)
    if (!Number.isFinite(appointmentMs) || appointmentMs <= now || appointmentMs > latestAllowed) {
      return {
        ok: false,
        error: 'Choose the real appointment date and time before saving Appointment Set.',
        code: 'appointment_details_required',
      }
    }
    appointmentAt = new Date(appointmentMs).toISOString()
  }

  return {
    ok: true,
    command: {
      disposition,
      notes: cleanText(body.notes, 5_000),
      phone: cleanText(body.phone, 100),
      appointmentAt,
      clientAttemptId: cleanText(body.clientAttemptId, 100),
    },
  }
}

export interface RecordedLeadDisposition {
  activityId: string | null
  appointmentId: string | null
  warning: string | null
}

interface DispositionActivityRow {
  id: string
  metadata: Record<string, unknown> | null
}

async function findAttemptActivity(
  leadId: string,
  activityType: 'appointment' | 'call',
  source: 'call_disposition' | 'telephony_bar',
  clientAttemptId: string | null,
): Promise<DispositionActivityRow | null> {
  if (!clientAttemptId) return null
  const { data, error } = await supabase
    .from('lead_activities')
    .select('id,metadata')
    .eq('lead_id', leadId)
    .eq('activity_type', activityType)
    .contains('metadata', { source, client_attempt_id: clientAttemptId })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error('Existing call outcome could not be verified')
  return (data as DispositionActivityRow | null) ?? null
}

export async function recordLeadDisposition(
  leadId: string,
  actorName: string,
  command: LeadDispositionCommand,
): Promise<RecordedLeadDisposition> {
  const { disposition, notes, phone, appointmentAt, clientAttemptId } = command
  let appointmentId: string | null = null
  let appointmentActivityId: string | null = null
  let activity = await findAttemptActivity(leadId, 'call', 'telephony_bar', clientAttemptId)
  if (activity && (
    activity.metadata?.disposition !== disposition
    || (activity.metadata?.scheduled_at ?? null) !== appointmentAt
  )) {
    throw new Error('This dialer attempt was already saved with a different outcome')
  }

  if (disposition === 'appointment_set' && appointmentAt) {
    const appointment = await upsertAppointmentFromCall({
      leadId,
      scheduledAt: appointmentAt,
      type: 'phone_call',
      notes,
      source: 'crm_call',
      assignedTo: actorName,
    })
    if (!appointment) throw new Error('Appointment could not be saved')
    appointmentId = appointment.id

    let appointmentActivity = await findAttemptActivity(
      leadId,
      'appointment',
      'call_disposition',
      clientAttemptId,
    )
    if (!appointmentActivity) {
      const { data, error } = await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'appointment',
        description: `Appointment scheduled from call for ${appointment.scheduled_at}${notes ? ` - ${notes}` : ''}`,
        agent: actorName,
        metadata: {
          appointment_id: appointment.id,
          type: appointment.type,
          scheduled_at: appointment.scheduled_at,
          due_date: appointment.scheduled_at,
          assigned_to: actorName,
          notes,
          status: 'scheduled',
          source: 'call_disposition',
          client_attempt_id: clientAttemptId,
        },
      })
      .select('id')
      .maybeSingle()
      if (error) {
        appointmentActivity = await findAttemptActivity(
          leadId,
          'appointment',
          'call_disposition',
          clientAttemptId,
        )
        if (!appointmentActivity) throw new Error('Appointment activity could not be saved')
      } else {
        appointmentActivity = data as DispositionActivityRow | null
      }
    }
    appointmentActivityId = appointmentActivity?.id ?? null
  }

  if (!activity) {
    const { data, error } = await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'call',
      description: `Call: ${disposition.replace(/_/g, ' ')}${notes ? ` - ${notes}` : ''}`,
      agent: actorName,
      metadata: {
        direction: 'outbound',
        disposition,
        phone,
        notes,
        source: 'telephony_bar',
        appointment_id: appointmentId,
        scheduled_at: appointmentAt,
        client_attempt_id: clientAttemptId,
      },
    })
    .select('id')
    .maybeSingle()
    if (error) {
      activity = await findAttemptActivity(leadId, 'call', 'telephony_bar', clientAttemptId)
      if (!activity) throw new Error('Call outcome could not be saved')
    } else {
      activity = data as DispositionActivityRow | null
    }
  }

  const leadPatch: Record<string, unknown> = {
    call_result: disposition,
    updated_at: new Date().toISOString(),
  }
  if (appointmentAt) {
    leadPatch.appointment_date = appointmentAt
    leadPatch.appointment_notes = notes
  }
  const { error: leadError } = await supabase.from('leads').update(leadPatch).eq('id', leadId)
  if (leadError) throw new Error('Contact outcome snapshot could not be saved')

  let lifecycleWarning: string | null = null
  if (disposition === 'appointment_set' && appointmentAt) {
    await checkAutoAdvance(leadId, 'appointment_set').catch((error) => {
      console.error('[lead disposition] appointment lifecycle advance failed:', error)
      lifecycleWarning = 'Appointment saved; lifecycle stage refresh is pending. Do not save the outcome again.'
    })
    await queuePpcAppointmentBookedConversion({
      leadId,
      appointmentId,
      activityId: appointmentActivityId,
      scheduledAt: appointmentAt,
      appointmentType: 'phone_call',
      assignedTo: actorName,
      source: 'call_disposition',
    }).catch((error) => console.error('[lead disposition] appointment conversion queue failed:', error))
  }

  if (EAGER_REGEN_EVENTS.has(disposition)) regenerateBriefing(leadId, disposition).catch(() => {})
  return { activityId: activity?.id ?? null, appointmentId, warning: lifecycleWarning }
}
