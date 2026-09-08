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
    surface: 'prospecting' as const,
    now: mondayAtNoonCentral,
    leads: [],
    suppressionReasons: [],
    prospectPhones: [],
    activities: [],
    companyOwnedNumbers: [],
    teamNumbers: [],
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
    expect(evaluateDialerCallPolicy(policyInput({
      surface: 'crm',
      now: new Date('2026-08-23T17:00:00.000Z'),
    }))).toMatchObject({ allowed: true })
  })

  it('treats 9:00 AM as open and 7:00 PM Central as closed', () => {
    expect(isWithinDialerCallingHours(new Date('2026-08-17T14:00:00.000Z'))).toBe(true)
    expect(isWithinDialerCallingHours(new Date('2026-08-18T00:00:00.000Z'))).toBe(false)
  })

  it('uses Central local time across daylight-saving changes', () => {
    expect(isWithinDialerCallingHours(new Date('2026-03-09T13:59:00.000Z'))).toBe(false)
    expect(isWithinDialerCallingHours(new Date('2026-03-09T14:00:00.000Z'))).toBe(true)
  })

  it('keeps company lines protected while separating CRM and Prospecting team calls', () => {
    expect(evaluateDialerCallPolicy(policyInput({
      companyOwnedNumbers: ['+19135550123'],
      surface: 'crm',
    }))).toMatchObject({
      allowed: false,
      reason: 'internal_destination',
      message: 'Company-owned phone numbers cannot be called from this dialer.',
    })

    expect(evaluateDialerCallPolicy(policyInput({
      teamNumbers: ['+19135550123'],
      surface: 'prospecting',
    }))).toMatchObject({
      allowed: false,
      reason: 'internal_destination',
      message: 'Team phone numbers cannot be called from the prospecting dialer.',
    })

    expect(evaluateDialerCallPolicy(policyInput({
      teamNumbers: ['+19135550123'],
      surface: 'crm',
    }))).toMatchObject({ allowed: true })
  })

  it('allows CRM lifecycle re-engagement without bypassing number-level dead reasons', () => {
    expect(evaluateDialerCallPolicy(policyInput({
      surface: 'crm',
      leads: [{ station: 'dead', classification: 'dead', dead_reason: 'not_selling' }],
    }))).toMatchObject({ allowed: true })

    expect(evaluateDialerCallPolicy(policyInput({
      surface: 'crm',
      leads: [{ station: 'dead', dead_reason: 'dnc_refused' }],
    }))).toMatchObject({ allowed: false, reason: 'do_not_call' })

    expect(evaluateDialerCallPolicy(policyInput({
      surface: 'crm',
      leads: [{ station: 'dead', dead_reason: 'wrong_or_disconnected' }],
    }))).toMatchObject({ allowed: false, reason: 'disconnected' })
  })

  it('keeps SMS-only opt-outs out of manual CRM voice policy', () => {
    expect(evaluateDialerCallPolicy(policyInput({
      surface: 'crm',
      suppressionReasons: ['STOP'],
    }))).toMatchObject({ allowed: true })

    expect(evaluateDialerCallPolicy(policyInput({
      surface: 'prospecting',
      suppressionReasons: ['STOP'],
    }))).toMatchObject({ allowed: false, reason: 'do_not_call' })
  })

  it('allows only server-owned callback exemptions from hours', () => {
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
