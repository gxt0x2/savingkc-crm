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
      ] as const,
      startLocal: '08:30',
      endLocal: '17:00',
    },
  }
}
