import { describe, expect, it } from 'vitest'
import {
  directInboundClientIdentity,
  directInboundClientNoun,
  inboundCallerDisplayName,
  inboundClientDialCallerId,
} from './direct-inbound-ring'

describe('direct inbound Voice client', () => {
  it('rings Ernest on both company numbers without dropping the cell leg', () => {
    expect(directInboundClientIdentity('+18166088588')).toBe('ernest')
    expect(directInboundClientIdentity('+18166088858')).toBe('ernest')
    expect(directInboundClientNoun('(816) 608-8588')).toBe('<Client>ernest</Client>')
  })

  it('does not attach Ernest to Casey or the main IVR line', () => {
    expect(directInboundClientIdentity('+18167277667')).toBeNull()
    expect(directInboundClientIdentity('+18163754666')).toBeNull()
    expect(directInboundClientIdentity('+18163077835')).toBeNull()
    expect(directInboundClientNoun('+18167277667')).toBe('')
    expect(directInboundClientNoun('+18167277667', {
      statusCallback: 'https://crm.savingkc.com/api/twilio-inbound-client-status',
    })).toBe('')
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

  it('drops synthetic intake labels so CallKit can show the number', () => {
    expect(inboundCallerDisplayName('Jane Seller')).toBe('Jane Seller')
    expect(inboundCallerDisplayName('Inbound Seller')).toBe('')
    expect(inboundCallerDisplayName('Unknown caller')).toBe('')
    expect(inboundCallerDisplayName('Caller (816) 555-0199')).toBe('')
  })
})
