import { enqueuePpcConversion } from '@/lib/ppc/conversion-outbox'
import { loadPpcLeadConversionContext } from '@/lib/ppc/lead-conversion-context'

export type QueuePpcAppointmentBookedConversionResult =
  | { queued: true; reason: 'queued' }
  | { queued: false; reason: string }

function optionalIso(value: string | Date | null | undefined): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

export async function queuePpcAppointmentBookedConversion(input: {
  leadId: string
  appointmentId?: string | null
  bookingId?: string | null
  activityId?: string | null
  scheduledAt?: string | Date | null
  scheduledTime?: string | null
  appointmentType?: string | null
  assignedTo?: string | null
  source?: string | null
  bookedAt?: string | Date | null
}): Promise<QueuePpcAppointmentBookedConversionResult> {
  const context = await loadPpcLeadConversionContext(input.leadId)
  if (!context.ok) return { queued: false, reason: context.reason }

  const queued = await enqueuePpcConversion({
    eventName: 'appointment_booked',
    eventCategory: 'appointment',
    leadId: input.leadId,
    activityId: input.activityId ?? null,
    dedupeKey: `lead:${input.leadId}:appointment_booked`,
    optimizationRole: 'secondary',
    approvedForGoogleAds: true,
    conversionValue: 1,
    eventTime: optionalIso(input.bookedAt) ?? undefined,
    attribution: context.attribution,
    payload: {
      source: input.source ?? 'crm_appointment',
      appointment_id: input.appointmentId ?? null,
      booking_id: input.bookingId ?? null,
      scheduled_at: optionalIso(input.scheduledAt),
      scheduled_time: input.scheduledTime ?? null,
      appointment_type: input.appointmentType ?? null,
      assigned_to: input.assignedTo ?? null,
      approval_required: false,
      google_ads_value_basis: 'factual_appointment_booked',
      user_identifiers: context.userIdentifiers.length ? context.userIdentifiers : undefined,
    },
  })

  return queued.queued
    ? { queued: true, reason: 'queued' }
    : { queued: false, reason: queued.reason }
}
