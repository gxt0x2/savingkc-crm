import { describe, expect, it } from 'vitest'
import {
  buildCarrierFallbackSmsLeadSeed,
  buildCarrierVoiceFallbackTwiml,
  carrierFallbackUrls,
  matchesCarrierRoute,
} from './carrier-fallback'

describe('carrier fallbacks', () => {
  it('builds stable production fallback URLs', () => {
    expect(carrierFallbackUrls('https://crm.savingkc.com/')).toEqual({
      voice: 'https://crm.savingkc.com/api/twilio/fallback/voice',
      sms: 'https://crm.savingkc.com/api/twilio/fallback/sms',
    })
    expect(matchesCarrierRoute('https://crm.savingkc.com/api/twilio/fallback/voice', '/api/twilio/fallback/voice')).toBe(true)
    expect(matchesCarrierRoute(null, '/api/twilio/fallback/voice')).toBe(false)
  })

  it('routes a failed carrier webhook directly to the owning agent with context', () => {
    const xml = buildCarrierVoiceFallbackTwiml({
      baseUrl: 'https://crm.savingkc.com',
      from: '+19135550199',
      calledNumber: '+18167277667',
      agentPhone: '+18167564943',
    })

    expect(xml).toContain('<Number>+18167564943</Number>')
    expect(xml).toContain('callerId="+18167277667"')
    expect(xml).toContain('type=direct')
    expect(xml).toContain('source=carrier_fallback')
  })

  it('creates an unqualified New record rather than assuming a seller lead', () => {
    expect(buildCarrierFallbackSmsLeadSeed({
      from: '(913) 555-0199',
      to: '+18163077835',
      assignedAgent: 'Ernest',
      messageSid: 'SM123',
    })).toMatchObject({
      phone: '+19135550199',
      station: 'new',
      priority: 'warm',
      classification: null,
      assigned_agent: 'Ernest',
    })
  })
})
