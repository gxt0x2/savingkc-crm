import { describe, expect, it } from 'vitest'
import {
  automaticBookingAllowed,
  callbackRequestPrecision,
} from '../calendar'

describe('callback request precision', () => {
  it('does not book a date-only or phone-only request', () => {
    expect(
      callbackRequestPrecision({ phone: '816-555-0101', timeText: 'tomorrow after 2' }),
    ).toBe('range_or_date')
    expect(callbackRequestPrecision({ phone: '816-555-0101' })).toBe(
      'phone_only',
    )
    expect(
      automaticBookingAllowed({
        precision: 'range_or_date',
        policyEnabled: true,
        calendarConnected: true,
        tokenFresh: true,
      }),
    ).toBe(false)
  })
  it('requires a verified exact slot and a live calendar before automatic booking', () => {
    expect(
      callbackRequestPrecision({
        phone: '816-555-0101',
        timeText: 'Tuesday at 14:30',
        timezone: 'America/Chicago',
        slotVerified: true,
      }),
    ).toBe('exact')
    expect(
      automaticBookingAllowed({
        precision: 'exact',
        policyEnabled: true,
        calendarConnected: false,
        tokenFresh: false,
      }),
    ).toBe(false)
  })
})
