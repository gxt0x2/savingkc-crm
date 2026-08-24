import { supabaseAdmin } from '@/lib/supabase/admin'

export interface CanonicalBookingInput {
  leadId: string
  firstName: string
  phone: string
  propertyAddress?: string | null
  slotDate: string
  slotTime: string
  slotDateTime: string
  bookingSource: string
  landingPage: string
  assignedTo: string
}

export interface CanonicalBookingResult {
  bookingId: string
  appointmentId: string
  replayed: boolean
}

export class CanonicalBookingError extends Error {
  constructor(
    public readonly code: 'slot_taken' | 'invalid' | 'unavailable',
    message: string,
  ) {
    super(message)
  }
}

function translatedError(message: string): CanonicalBookingError {
  if (message.includes('booking_slot_taken')) {
    return new CanonicalBookingError('slot_taken', 'This time slot was just taken. Please choose another time.')
  }
  if (message.includes('booking_invalid_') || message.includes('booking_slot_mismatch') || message.includes('booking_lead_not_found')) {
    return new CanonicalBookingError('invalid', 'The booking details are invalid. Please refresh and choose a time again.')
  }
  return new CanonicalBookingError('unavailable', 'Booking is temporarily unavailable. Please try again.')
}

export async function createCanonicalBooking(input: CanonicalBookingInput): Promise<CanonicalBookingResult> {
  const { data, error } = await supabaseAdmin().rpc('create_canonical_booking_v1', {
    p_lead_id: input.leadId,
    p_first_name: input.firstName,
    p_phone: input.phone,
    p_property_address: input.propertyAddress ?? '',
    p_slot_date: input.slotDate,
    p_slot_time: input.slotTime,
    p_slot_datetime: input.slotDateTime,
    p_booking_source: input.bookingSource,
    p_landing_page: input.landingPage,
    p_assigned_to: input.assignedTo,
  })

  if (error) throw translatedError(error.message || '')
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row.booking_id !== 'string' || typeof row.appointment_id !== 'string') {
    throw new CanonicalBookingError('unavailable', 'Booking is temporarily unavailable. Please try again.')
  }

  return {
    bookingId: row.booking_id,
    appointmentId: row.appointment_id,
    replayed: row.replayed === true,
  }
}
