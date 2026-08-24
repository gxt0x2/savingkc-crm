import { describe, expect, it } from 'vitest'
import { buildDirectInboundLeadSeed } from './direct-inbound-intake'

describe('direct inbound caller intake', () => {
  const input = {
    phone: '+18165550123',
    displayPhone: '(816) 555-0123',
    assignedAgent: 'Ernest',
    calledNumber: '+18166088588',
    callSid: 'CA123',
  }

  it('starts an unknown connected caller as New without bypassing qualification', () => {
    expect(buildDirectInboundLeadSeed(input)).toMatchObject({
      phone: '+18165550123',
      source: 'inbound_call',
      station: 'new',
      priority: 'warm',
      classification: null,
      assigned_agent: 'Ernest',
    })
  })
})
