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
    expect(xml).not.toContain('<Client>')
    expect(xml).toContain('callerId="+18167277667"')
    expect(xml).toContain('type=direct')
    expect(xml).toContain('source=carrier_fallback')
  })

  it('rings Ernest in the app and on the cell when the company webhook is down', () => {
    const xml = buildCarrierVoiceFallbackTwiml({
      baseUrl: 'https://crm.savingkc.com',
      from: '+19137179716',
      calledNumber: '+18166088588',
      agentPhone: '+18162262552',
    })

    expect(xml).toContain('<Identity>ernest</Identity>')
    expect(xml).toContain('<Parameter name="callerNumber" value="+19137179716" />')
    expect(xml).toContain('<Parameter name="callerName" value="" />')
    expect(xml).toContain('<Parameter name="calledNumber" value="+18166088588" />')
    expect(xml).toContain('<Number>+18162262552</Number>')
    expect(xml).toContain('callerId="+19137179716"')
    expect(xml).not.toContain('callerId="+18166088588"')
    expect(xml).toContain('timeout="15"')
  })

  it('puts a CRM name on the Voice client without dropping the cell', () => {
    const xml = buildCarrierVoiceFallbackTwiml({
      baseUrl: 'https://crm.savingkc.com',
      from: '+19137179716',
      calledNumber: '+18166088588',
      agentPhone: '+18162262552',
      callerName: 'Jane Seller',
    })

    expect(xml).toContain('<Parameter name="callerName" value="Jane Seller" />')
    expect(xml).toContain('<Number>+18162262552</Number>')
    expect(xml).toContain('callerId="+19137179716"')
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
