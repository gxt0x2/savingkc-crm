import { describe, expect, it } from 'vitest'
import {
  evaluateDialerCallPolicy,
  isWithinDialerCallingHours,
  phoneLookupVariants,
} from './dialer-call-policy'

const mondayAtNoonCentral = new Date('2026-08-17T17:00:00.000Z')

function policyInput(overrides: Partial<Parameters<typeof evaluateDialerCallPolicy>[0]> = {}) {
  return {
    phone: '+19135550123',
    now: mondayAtNoonCentral,
    leads: [],
    suppressionReasons: [],
    prospectPhones: [],
    activities: [],
    manifests: [],
    internalNumbers: [],
    ...overrides,
  }
}

describe('dialer call policy', () => {
  it('allows an unsuppressed number during the SavingKC calling window', () => {
    expect(evaluateDialerCallPolicy(policyInput({ phone: '(913) 555-0123' }))).toEqual({
      allowed: true,
      normalizedPhone: '+19135550123',
    })
  })

  it.each([
    [{ suppressionReasons: ['STOP'] }, 'do_not_call'],
    [{ leads: [{ station: 'dead' }] }, 'dead_lead'],
    [{ leads: [{ station: 'closed_lost' }] }, 'dead_lead'],
    [{ leads: [{ call_result: 'wrong_number' }] }, 'wrong_number'],
    [{ prospectPhones: [{ last_disposition: 'disconnected' }] }, 'disconnected'],
    [{ prospectPhones: [{ phone_connected: false }] }, 'disconnected'],
    [{ activities: [{ phone_status: 'blocked' }] }, 'blocked_number'],
  ] as const)('blocks a known stop signal', (facts, reason) => {
    expect(evaluateDialerCallPolicy(policyInput(facts))).toMatchObject({
      allowed: false,
      reason,
    })
  })

  it('blocks invalid numbers and calls outside the configured window', () => {
    expect(evaluateDialerCallPolicy(policyInput({ phone: '123' }))).toMatchObject({ reason: 'invalid_phone' })
    expect(evaluateDialerCallPolicy(policyInput({
      now: new Date('2026-08-17T13:59:00.000Z'),
    }))).toMatchObject({ reason: 'outside_calling_hours' })
    expect(evaluateDialerCallPolicy(policyInput({
      now: new Date('2026-08-23T17:00:00.000Z'),
    }))).toMatchObject({ reason: 'outside_calling_hours' })
  })

  it('treats 9:00 AM as open and 7:00 PM Central as closed', () => {
    expect(isWithinDialerCallingHours(new Date('2026-08-17T14:00:00.000Z'))).toBe(true)
    expect(isWithinDialerCallingHours(new Date('2026-08-18T00:00:00.000Z'))).toBe(false)
  })

  it('uses Central local time across daylight-saving changes', () => {
    expect(isWithinDialerCallingHours(new Date('2026-03-09T13:59:00.000Z'))).toBe(false)
    expect(isWithinDialerCallingHours(new Date('2026-03-09T14:00:00.000Z'))).toBe(true)
  })

  it('blocks internal destinations and allows only server-owned callback exemptions from hours', () => {
    expect(evaluateDialerCallPolicy(policyInput({
      internalNumbers: ['+19135550123'],
    }))).toMatchObject({ allowed: false, reason: 'internal_destination' })

    expect(evaluateDialerCallPolicy(policyInput({
      now: new Date('2026-08-17T13:00:00.000Z'),
      callingHoursExempt: true,
    }))).toMatchObject({ allowed: true })
  })

  it('builds stable lookup variants without accepting a non-US number', () => {
    expect(phoneLookupVariants('(913) 555-0123')).toEqual([
      '(913) 555-0123',
      '+19135550123',
      '19135550123',
      '9135550123',
      '913-555-0123',
      '913 555 0123',
      '913.555.0123',
    ])
    expect(phoneLookupVariants('+442079460000')).toEqual([])
  })
})
