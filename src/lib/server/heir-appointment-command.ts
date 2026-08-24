import { upsertAppointmentFromCall } from '@/lib/appointments'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { queuePpcAppointmentBookedConversion } from '@/lib/ppc/appointment-booked-conversion'
import { insertHeirAttemptEvidenceOnce } from '@/lib/server/heir-attempt-evidence'

export async function recordHeirAppointment(input: {
  leadId: string
  actorName: string
  appointmentAt: string
  notes: string | null
  clientAttemptId: string | null
  prospectPhoneId: string
  heirName: string | null
}) {
  const appointment = await upsertAppointmentFromCall({
    leadId: input.leadId,
    scheduledAt: input.appointmentAt,
    type: 'phone_call',
    notes: input.notes,
    source: 'crm_call',
    assignedTo: input.actorName,
  })
  if (!appointment) throw new Error('Appointment could not be saved')

  const activity = await insertHeirAttemptEvidenceOnce({
    leadId: input.leadId,
    prospectId: null,
    activityType: 'appointment',
    clientAttemptId: input.clientAttemptId,
    action: 'appointment_set',
    payload: {
      lead_id: input.leadId,
      activity_type: 'appointment',
      description: `Appointment scheduled with ${input.heirName || 'heir'} for ${appointment.scheduled_at}`,
      agent: input.actorName,
      metadata: {
        source: 'heir_dialer',
        action: 'appointment_set',
        client_attempt_id: input.clientAttemptId,
        prospect_phone_id: input.prospectPhoneId,
        appointment_id: appointment.id,
        scheduled_at: appointment.scheduled_at,
        due_date: appointment.scheduled_at,
        status: 'scheduled',
        notes: input.notes,
      },
    },
  })

  await checkAutoAdvance(input.leadId, 'appointment_set').catch((error) => {
    console.error('[heirs/attempt] appointment lifecycle advance failed:', error)
  })
  await queuePpcAppointmentBookedConversion({
    leadId: input.leadId,
    appointmentId: appointment.id,
    activityId: activity.id,
    scheduledAt: appointment.scheduled_at,
    appointmentType: 'phone_call',
    assignedTo: input.actorName,
    source: 'heir_dialer',
  }).catch((error) => console.error('[heirs/attempt] appointment conversion queue failed:', error))

  return { appointmentId: appointment.id, activityId: activity.id }
}
