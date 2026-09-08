import { describe, expect, it } from 'vitest'
import { createDialerCallIntent, verifyDialerCallIntent } from './dialer-call-intent'

const secret = 'test-only-secret-at-least-32-characters'
const now = new Date('2026-08-17T17:00:00.000Z')

describe('dialer call intents', () => {
  it('round-trips a signed Prospecting surface and contact context', () => {
    const issued = createDialerCallIntent({
      identity: 'Casey',
      to: '(913) 555-0123',
      callerId: '+18167277667',
      kind: 'heir',
      source: 'web_heir_dialer',
      surface: 'prospecting',
      leadId: 'lead-1',
      prospectPhoneId: 'phone-1',
      clientAttemptId: 'attempt-1',
    }, { secret, now })

    expect(verifyDialerCallIntent(issued.token, { secret, now })).toEqual({ valid: true, claims: issued.claims })
    expect(issued.claims).toMatchObject({
      identity: 'casey',
      to: '+19135550123',
      callerId: '+18167277667',
      kind: 'heir',
      source: 'web_heir_dialer',
      surface: 'prospecting',
    })
  })

  it('rejects tampering, expiry, and a missing token', () => {
    const issued = createDialerCallIntent({
      identity: 'ernest',
      to: '+19135550123',
      callerId: '+18166088588',
      kind: 'manual',
      source: 'web_manual',
      surface: 'crm',
    }, { secret, now })

    expect(verifyDialerCallIntent(`${issued.token}x`, { secret, now })).toEqual({ valid: false, reason: 'invalid_signature' })
    expect(verifyDialerCallIntent(issued.token, { secret, now: new Date('2026-08-17T17:02:00.000Z') })).toEqual({ valid: false, reason: 'expired' })
    expect(verifyDialerCallIntent(null, { secret, now })).toEqual({ valid: false, reason: 'missing' })
  })

  it('requires context that matches the declared intent kind', () => {
    expect(() => createDialerCallIntent({
      identity: 'ernest',
      to: '+19135550123',
      callerId: '+18166088588',
      kind: 'lead',
      source: 'web_power_dialer',
      surface: 'prospecting',
    }, { secret, now })).toThrow('context is invalid')
  })

  it('rejects a source that does not belong to the signed surface', () => {
    expect(() => createDialerCallIntent({
      identity: 'ernest',
      to: '+19135550123',
      callerId: '+18166088588',
      kind: 'lead',
      source: 'web_power_dialer',
      surface: 'crm',
      leadId: 'lead-1',
    }, { secret, now })).toThrow('context is invalid')
  })
})
