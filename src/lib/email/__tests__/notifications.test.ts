import { describe, expect, it } from 'vitest'
import {
  canUseUnscopedPushFeed,
  extractPhoneSignal,
  lockscreenAlertCopy,
} from '../notifications'

describe('email phone alerts', () => {
  it('extracts a new number only from visible text', () => {
    expect(extractPhoneSignal('Call me at 816-555-0101').kind).toBe(
      'callback_request',
    )
    expect(
      extractPhoneSignal('Thanks\n--\nCall me at 816-555-0101').phone,
    ).toBeNull()
    expect(extractPhoneSignal('816-555-0101').kind).toBe('phone_only')
    expect(extractPhoneSignal('816-555-0101').createsLead).toBe(false)
    expect(extractPhoneSignal('816-555-0101').createsOpportunity).toBe(false)
  })
  it('keeps lockscreen copy free of seller or property detail', () => {
    expect(lockscreenAlertCopy('callback')).toBe(
      'Callback request — open Email',
    )
    expect(lockscreenAlertCopy('phone')).not.toMatch(/Oak|Jamie|64111/)
    expect(canUseUnscopedPushFeed()).toBe(false)
  })
})
