import { describe, expect, it } from 'vitest'
import {
  INTENDED_OUTREACH_DOMAINS,
  PRIMARY_BUSINESS_DOMAIN,
  intendedOutreachDomainNames,
  intendedOutreachReadiness,
} from '../domains/intended'
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
  it('treats owned outreach names as independent of the business domain and not sending-ready', () => {
    expect(PRIMARY_BUSINESS_DOMAIN).toBe('savingkc.com')
    expect(intendedOutreachDomainNames()).toEqual([
      'talktosavingkc.com',
      'savingkcteam.com',
      'yourkchomebuyer.com',
    ])
    expect(() =>
      assertIndependentSendingDomain(
        PRIMARY_BUSINESS_DOMAIN,
        PRIMARY_BUSINESS_DOMAIN,
      ),
    ).toThrow('PRIMARY_DOMAIN_OR_SUBDOMAIN_FORBIDDEN')
    for (const domain of INTENDED_OUTREACH_DOMAINS) {
      expect(
        assertIndependentSendingDomain(domain.name, PRIMARY_BUSINESS_DOMAIN),
      ).toBe(domain.name)
      expect(intendedOutreachReadiness(domain)).toEqual({
        registrarOwned: true,
        nameserversOnCloudflare: true,
        dnsReady: false,
        resendReady: false,
        sendingReady: false,
      })
    }
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
