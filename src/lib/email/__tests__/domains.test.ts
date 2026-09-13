import { describe, expect, it } from 'vitest'
import {
  assertIndependentSendingDomain,
  senderCanReceive,
  senderCanStartNewEnrollment,
} from '../providers/resend-domains'
describe('sending domains', () => {
  it('rejects primary domain, subdomains and same registrable domain', () => {
    expect(() =>
      assertIndependentSendingDomain('mail.savingkc.com', 'savingkc.com'),
    ).toThrow()
    expect(() =>
      assertIndependentSendingDomain('savingkc.co.uk', 'app.savingkc.co.uk'),
    ).toThrow()
    expect(
      assertIndependentSendingDomain('savingkc-mail.com', 'savingkc.com'),
    ).toBe('savingkc-mail.com')
  })
  it('retired senders keep receiving but cannot enroll', () => {
    expect(senderCanStartNewEnrollment('retired')).toBe(false)
    expect(senderCanReceive('retired')).toBe(true)
  })
})
it('rejects URL-shaped, email-shaped, IP and invalid domain values before provider access', () => {
  for (const value of [
    'https://outside.com',
    'person@outside.com',
    'outside.com:443',
    'outside.com/path',
    '127.0.0.1',
    'foo.localhost',
    '-outside.com',
    'outside..com',
    'outside.com.',
  ])
    expect(() => assertIndependentSendingDomain(value, 'savingkc.com')).toThrow(
      'INVALID_EMAIL_DOMAIN',
    )
  expect(
    assertIndependentSendingDomain(
      ' MAIL.SAVINGKC-OUTREACH.COM ',
      'savingkc.com',
    ),
  ).toBe('mail.savingkc-outreach.com')
})
