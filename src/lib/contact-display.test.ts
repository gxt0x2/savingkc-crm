import { describe, expect, it } from 'vitest'
import {
  formatDurationBetween,
  formatLeadSource,
  getActivityOutcome,
  getAvatarLabel,
  getDisplayLeadName,
  isOutboundAttempt,
} from './contact-display'

describe('contact-display', () => {
  it('uses GA avatar and Google Ads source label for PPC leads', () => {
    expect(getAvatarLabel('Casey Seller', '+18165551212', 'ppc-landing')).toBe('GA')
    expect(formatLeadSource('ppc-landing')).toBe('Google Ads')
    expect(getAvatarLabel('Google Ads Caller', '+18165551212', 'google_ads_phone')).toBe('GA')
    expect(formatLeadSource('google_ads_phone')).toBe('Google Ads')
    expect(getAvatarLabel('Google Ads Tax Caller', '+18165551212', 'google_ads_tax_phone')).toBe('GA')
    expect(formatLeadSource('google_ads_tax_phone')).toBe('Google Ads Tax')
  })

  it('falls back to phone when the stored name is only a caller placeholder', () => {
    expect(getDisplayLeadName('Caller 4', '+18165551212')).toBe('(816) 555-1212')
    expect(getAvatarLabel('Caller 4', '+18165551212', 'inbound_call')).toBe('12')
  })

  it('collapses double parentheses around formatted phone numbers', () => {
    expect(getDisplayLeadName('Google Ads Caller ((816) 555-1212)', '+18165551212')).toBe('Google Ads Caller (816) 555-1212')
  })

  it('detects missed inbound calls and outbound attempts', () => {
    const missed = {
      activity_type: 'call',
      description: 'Inbound call from +18165551212 - no-answer',
      metadata: { direction: 'inbound', status: 'no-answer' },
    }
    const outbound = {
      activity_type: 'sms',
      description: 'Auto text sent',
      metadata: { direction: 'outbound' },
    }

    expect(getActivityOutcome(missed)).toBe('missed')
    expect(isOutboundAttempt(outbound)).toBe(true)
  })

  it('formats elapsed time between system entry and first outbound', () => {
    expect(formatDurationBetween('2026-05-20T10:00:00.000Z', '2026-05-20T12:35:00.000Z')).toBe('2h 35m')
  })
})
