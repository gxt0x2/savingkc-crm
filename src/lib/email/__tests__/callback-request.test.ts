import { describe, expect, it } from 'vitest'
import { callbackRequest, isCallbackTest } from '../workflow/callback-request'

describe('human callback routing evidence', () => {
  it('distinguishes explicit callbacks, bare numbers and test messages', () => {
    expect(callbackRequest('Call me at 816-555-0101 tomorrow afternoon.')).toMatchObject({ phone: '816-555-0101', explicitCall: true, testOnly: false })
    expect(callbackRequest('816-555-0101')).toMatchObject({ explicitCall: false })
    expect(callbackRequest('SYSTEM TEST — Call me at 816-555-0101 (false number) tomorrow afternoon.')).toMatchObject({ testOnly: true })
    expect(isCallbackTest('Fake number 816-555-0101')).toBe(true)
  })
  it.each([
    'Do not call me at 816-555-0101.',
    'Call me at 816-555-0101. Stop emailing me.',
    'Call me at 816-555-0101. No more emails.',
    'My brother says call me at 816-555-0101.',
    'Thanks.\nOn Monday Pat wrote:\nCall me at 816-555-0101.',
    '> Call me at 816-555-0101.\nThanks.',
  ])('does not route revoked, third-party or quoted requests: %s', body => {
    expect(callbackRequest(body)).toBeNull()
  })
})
