import { describe, expect, it } from 'vitest'
import {
  INTENDED_OUTREACH_DOMAINS,
  PRIMARY_BUSINESS_DOMAIN,
  intendedOutreachDomainNames,
  intendedOutreachOpsLabel,
  intendedOutreachReadiness,
  outreachSendingUnlocked,
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
  it('records ops-verified outreach DNS without unlocking live send', () => {
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
    expect(outreachSendingUnlocked()).toBe(false)
    const talk = INTENDED_OUTREACH_DOMAINS.find(
      (d) => d.name === 'talktosavingkc.com',
    )!
    const team = INTENDED_OUTREACH_DOMAINS.find(
      (d) => d.name === 'savingkcteam.com',
    )!
    const buyer = INTENDED_OUTREACH_DOMAINS.find(
      (d) => d.name === 'yourkchomebuyer.com',
    )!
    expect(intendedOutreachReadiness(talk)).toMatchObject({
      dnsReady: true,
      resendAdded: true,
      resendVerify: 'verified',
      receivingEnabled: true,
      sendingReady: false,
    })
    expect(intendedOutreachReadiness(team).resendVerify).toBe('partial')
    expect(intendedOutreachReadiness(buyer).resendVerify).toBe('partial')
    for (const domain of INTENDED_OUTREACH_DOMAINS) {
      expect(
        assertIndependentSendingDomain(domain.name, PRIMARY_BUSINESS_DOMAIN),
      ).toBe(domain.name)
      expect(intendedOutreachReadiness(domain).sendingReady).toBe(false)
      expect(intendedOutreachOpsLabel(domain)).toMatch(/Sending stays off/)
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
