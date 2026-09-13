export function schedulingMode(input: {
  calendarConnected: boolean
  exactRequest: boolean
  slotVerified: boolean
  hasPhoneEvidence: boolean
}) {
  return input.calendarConnected &&
    input.exactRequest &&
    input.slotVerified &&
    input.hasPhoneEvidence
    ? 'calendar'
    : 'task'
}

export function canEnableAutomaticBooking(input: {
  calendarConnected: boolean
  tokenFresh: boolean
  hoursValid: boolean
  alertsConfigured: boolean
}) {
  return (
    input.calendarConnected &&
    input.tokenFresh &&
    input.hoursValid &&
    input.alertsConfigured
  )
}

export type CallbackPrecision =
  | 'exact'
  | 'range_or_date'
  | 'phone_only'
  | 'clarify'

export function callbackRequestPrecision(input: {
  phone?: string | null
  timeText?: string | null
  timezone?: string | null
  slotVerified?: boolean
}) {
  const time = input.timeText?.trim() ?? ''
  const phone = Boolean(input.phone?.trim())
  if (
    input.slotVerified &&
    phone &&
    time &&
    input.timezone === 'America/Chicago' &&
    /\d{1,2}:\d{2}/.test(time)
  )
    return 'exact' as const
  if (phone && !time) return 'phone_only' as const
  if (
    time &&
    (/\b(after|before|morning|afternoon|evening|tomorrow|next friday)\b/i.test(
      time,
    ) ||
      !/\d{1,2}:\d{2}/.test(time))
  )
    return 'range_or_date' as const
  return 'clarify' as const
}

export function automaticBookingAllowed(input: {
  precision: CallbackPrecision
  policyEnabled: boolean
  calendarConnected: boolean
  tokenFresh: boolean
}) {
  return (
    input.precision === 'exact' &&
    input.policyEnabled &&
    input.calendarConnected &&
    input.tokenFresh
  )
}

export function defaultCallbackPolicy() {
  return {
    durationMinutes: 15,
    bufferMinutes: 10,
    maxDailyBookings: 8,
    hours: {
      timezone: 'America/Chicago',
      weekdays: [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
      ] as Array<
        'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday'
      >,
      startLocal: '08:30',
      endLocal: '17:00',
    },
  }
}
