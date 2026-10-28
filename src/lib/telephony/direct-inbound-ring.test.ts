import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveAgentTelephonyProfile } from './agent-identity'
import {
  directInboundClientIdentity,
  directInboundClientNoun,
  inboundCallerDisplayName,
  inboundClientDialCallerId,
  inboundRingPlan,
  ownedInboundCompanyNumbers,
} from './direct-inbound-ring'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('direct inbound Voice client', () => {
  it('rings Ernest on both company numbers without dropping the cell leg', () => {
    expect(directInboundClientIdentity('+18166088588')).toBe('ernest')
    expect(directInboundClientIdentity('+18166088858')).toBe('ernest')
    expect(directInboundClientNoun('(816) 608-8588')).toBe('<Client>ernest</Client>')
  })

  it('does not attach Ernest to Casey or the main IVR line', () => {
    expect(directInboundClientIdentity('+18167277667')).toBe('casey')
    expect(directInboundClientIdentity('+18163754666')).toBe('casey')
    expect(directInboundClientIdentity('+18163077835')).toBeNull()
    expect(directInboundClientNoun('+18167277667')).toBe('<Client>casey</Client>')
    expect(directInboundClientNoun('+18167277667')).not.toContain('ernest')
    expect(directInboundClientNoun('+18163077835')).toBe('')
    expect(inboundRingPlan('+18167277667')).toEqual({
      kind: 'direct',
      identity: resolveAgentTelephonyProfile('casey@savingkc.com').identity,
      cell: '+18167564943',
      personalForwardSuppressed: false,
    })
  })

  it('adds a client-leg status callback without changing the identity', () => {
    expect(directInboundClientNoun('+18166088588', {
      statusCallback: 'https://crm.savingkc.com/api/twilio-inbound-client-status?leg=client&from=a',
    })).toBe('<Client statusCallback="https://crm.savingkc.com/api/twilio-inbound-client-status?leg=client&amp;from=a" statusCallbackEvent="initiated ringing answered completed" statusCallbackMethod="POST">ernest</Client>')
  })

  it('passes the PSTN caller into Client parameters and keeps the status callback', () => {
    expect(directInboundClientNoun('+18166088588', {
      statusCallback: 'https://crm.savingkc.com/api/twilio-inbound-client-status',
      callerNumber: '+18165550199',
      callerName: 'Jane & "Jo"',
      calledNumber: '+18166088588',
    })).toBe('<Client statusCallback="https://crm.savingkc.com/api/twilio-inbound-client-status" statusCallbackEvent="initiated ringing answered completed" statusCallbackMethod="POST"><Identity>ernest</Identity><Parameter name="callerNumber" value="+18165550199" /><Parameter name="callerName" value="Jane &amp; &quot;Jo&quot;" /><Parameter name="calledNumber" value="+18166088588" /></Client>')
  })

  it('sends an empty caller name when the CRM has no displayable contact', () => {
    expect(directInboundClientNoun('(816) 608-8588', {
      callerNumber: '8165550199',
      callerName: 'New caller · (816) 555-0199',
      calledNumber: '+18166088588',
    })).toBe('<Client><Identity>ernest</Identity><Parameter name="callerNumber" value="+18165550199" /><Parameter name="callerName" value="" /><Parameter name="calledNumber" value="+18166088588" /></Client>')
  })

  it('uses the PSTN From as the client dial caller ID and keeps the company DID for cell-only rings', () => {
    expect(inboundClientDialCallerId({
      from: '+18165550199',
      calledNumber: '+18166088588',
      ringsClient: true,
    })).toBe('+18165550199')
    expect(inboundClientDialCallerId({
      from: 'Anonymous',
      calledNumber: '+18166088588',
      ringsClient: true,
    })).toBe('+18166088588')
    expect(inboundClientDialCallerId({
      from: '+18165550199',
      calledNumber: '+18167277667',
      ringsClient: false,
    })).toBe('+18167277667')
  })

  it('dials client:ernest only when in-app voice is on and personal forward is off', () => {
    vi.stubEnv('MOBILE_IN_APP_VOICE', 'true')
    vi.stubEnv('MOBILE_PERSONAL_FORWARD', 'false')
    for (const number of ['+18164292900', '+18166088588', '+18166088858']) {
      expect(inboundRingPlan(number)).toMatchObject({
        kind: 'direct',
        identity: 'ernest',
        cell: null,
        personalForwardSuppressed: true,
      })
    }
    expect(directInboundClientIdentity('+18164292900')).toBe('ernest')
    expect(ownedInboundCompanyNumbers('ernest')).toContain('+18164292900')
  })

  it('dials the documented personal cell when personal forward is on', () => {
    vi.stubEnv('MOBILE_PERSONAL_FORWARD', 'true')
    vi.stubEnv('MOBILE_IN_APP_VOICE', 'true')
    expect(inboundRingPlan('+18164292900')).toMatchObject({
      identity: 'ernest',
      cell: '+18162262552',
      personalForwardSuppressed: false,
    })
    vi.stubEnv('MOBILE_IN_APP_VOICE', 'false')
    expect(inboundRingPlan('+18166088588')).toMatchObject({
      identity: null,
      cell: '+18162262552',
      personalForwardSuppressed: false,
    })
  })

  it('leaves the business line on the seller IVR until in-app voice is enabled', () => {
    expect(inboundRingPlan('+18164292900')).toMatchObject({ kind: 'passthrough', identity: null, cell: null })
    expect(directInboundClientIdentity('+18164292900')).toBeNull()
  })

  it('fails closed to no PSTN leg when both flags are false', () => {
    vi.stubEnv('MOBILE_IN_APP_VOICE', 'false')
    vi.stubEnv('MOBILE_PERSONAL_FORWARD', 'false')
    expect(inboundRingPlan('+18166088588')).toMatchObject({
      kind: 'direct',
      identity: null,
      cell: null,
      personalForwardSuppressed: true,
    })
  })

  it('rings Casey company DIDs in the app unless in-app voice is off, and the cell unless personal forward is off', () => {
    const numbers = ['+18167277667', '+18163754666']
    const rows = [
      { inApp: 'true', personal: 'false', identity: 'casey', cell: null, personalForwardSuppressed: true },
      { inApp: 'true', personal: 'true', identity: 'casey', cell: '+18167564943', personalForwardSuppressed: false },
      { inApp: 'false', personal: 'true', identity: null, cell: '+18167564943', personalForwardSuppressed: false },
      { inApp: 'false', personal: 'false', identity: null, cell: null, personalForwardSuppressed: true },
    ] as const

    for (const number of numbers) {
      for (const row of rows) {
        vi.stubEnv('MOBILE_IN_APP_VOICE', row.inApp)
        vi.stubEnv('MOBILE_PERSONAL_FORWARD', row.personal)
        expect(inboundRingPlan(number), `${number} inApp=${row.inApp} personal=${row.personal}`).toEqual({
          kind: 'direct',
          identity: row.identity,
          cell: row.cell,
          personalForwardSuppressed: row.personalForwardSuppressed,
        })
        expect(directInboundClientIdentity(number)).not.toBe('ernest')
      }
    }

    vi.stubEnv('MOBILE_IN_APP_VOICE', '')
    vi.stubEnv('MOBILE_PERSONAL_FORWARD', 'false')
    expect(inboundRingPlan('+18167277667')).toEqual({
      kind: 'direct',
      identity: 'casey',
      cell: null,
      personalForwardSuppressed: true,
    })
    expect(directInboundClientNoun('+18167277667', {
      callerNumber: '+18165550199',
      callerName: 'Jane Seller',
      calledNumber: '+18167277667',
    })).toContain('<Client><Identity>casey</Identity>')
    expect(directInboundClientNoun('+18163754666', {
      statusCallback: 'https://crm.savingkc.com/api/twilio-inbound-client-status',
      callerNumber: '+18165550199',
      calledNumber: '+18163754666',
    })).toContain('<Identity>casey</Identity>')
    expect(directInboundClientNoun('+18167277667')).not.toContain('ernest')
    expect(ownedInboundCompanyNumbers('casey')).toEqual(['+18167277667'])
  })

  it('drops synthetic intake labels so CallKit can show the number', () => {
    expect(inboundCallerDisplayName('Jane Seller')).toBe('Jane Seller')
    expect(inboundCallerDisplayName('Inbound Seller')).toBe('')
    expect(inboundCallerDisplayName('Unknown caller')).toBe('')
    expect(inboundCallerDisplayName('Caller (816) 555-0199')).toBe('')
  })
})
