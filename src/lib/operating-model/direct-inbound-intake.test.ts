import { describe, expect, it, vi } from 'vitest'
import { buildDirectInboundLeadSeed, buildDirectInboundQualificationTask } from './direct-inbound-intake'

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

  it('creates a dedupeable owner-specific qualification action', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T15:00:00.000Z'))
    expect(buildDirectInboundQualificationTask(input)).toMatchObject({
      activity_type: 'task',
      metadata: {
        source: 'direct_inbound_intake',
        call_sid: 'CA123',
        assigned_to: 'Ernest',
        status: 'pending',
        due_date: '2026-08-03T15:15:00.000Z',
      },
    })
    vi.useRealTimers()
  })
})
