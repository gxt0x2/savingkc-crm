import { describe, expect, it } from 'vitest'
import {
  canEnableAutomaticBooking,
  defaultCallbackPolicy,
  schedulingMode,
} from '../calendar'

describe('callback scheduling', () => {
  it('does not guess a calendar appointment', () => {
    expect(
      schedulingMode({
        calendarConnected: true,
        exactRequest: false,
        slotVerified: true,
        hasPhoneEvidence: true,
      }),
    ).toBe('task')
    expect(
      schedulingMode({
        calendarConnected: true,
        exactRequest: true,
        slotVerified: true,
        hasPhoneEvidence: true,
      }),
    ).toBe('calendar')
  })
  it('keeps automatic booking off without a verified live calendar', () => {
    expect(
      canEnableAutomaticBooking({
        calendarConnected: false,
        tokenFresh: false,
        hoursValid: true,
        alertsConfigured: true,
      }),
    ).toBe(false)
    expect(defaultCallbackPolicy().durationMinutes).toBe(15)
    expect(defaultCallbackPolicy().bufferMinutes).toBe(10)
  })
})
