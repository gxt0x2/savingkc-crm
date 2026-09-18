import { describe, expect, it } from 'vitest'
import {
  filterLeadConversation,
  leadActivityText,
  leadConversationCounts,
  normalizeLeadConversation,
  type LeadConversationActivity,
} from './lead-conversation'

function activity(overrides: Partial<LeadConversationActivity> & Pick<LeadConversationActivity, 'id' | 'activity_type' | 'created_at'>): LeadConversationActivity {
  return {
    description: null,
    metadata: null,
    ...overrides,
  }
}

describe('lead conversation timeline', () => {
  it('orders communication newest first without mutating the source', () => {
    const source = [
      activity({ id: 'older', activity_type: 'sms', created_at: '2026-07-30T15:00:00.000Z' }),
      activity({ id: 'newest', activity_type: 'call', created_at: '2026-07-31T15:00:00.000Z' }),
      activity({ id: 'middle', activity_type: 'email', created_at: '2026-07-31T12:00:00.000Z' }),
    ]

    expect(normalizeLeadConversation(source).map((item) => item.id)).toEqual(['newest', 'middle', 'older'])
    expect(source.map((item) => item.id)).toEqual(['older', 'newest', 'middle'])
  })

  it('filters notes as one communication type', () => {
    const source = [
      activity({ id: 'note', activity_type: 'note', created_at: '2026-07-31T15:00:00.000Z' }),
      activity({ id: 'agent-note', activity_type: 'agent_note', created_at: '2026-07-31T14:00:00.000Z' }),
      activity({ id: 'sms', activity_type: 'sms', created_at: '2026-07-31T13:00:00.000Z' }),
    ]

    expect(filterLeadConversation(source, 'note').map((item) => item.id)).toEqual(['note', 'agent-note'])
    expect(leadConversationCounts(source)).toEqual({ all: 3, call: 0, sms: 1, email: 0, note: 2, voicemail: 0 })
  })

  it('deduplicates mirrored communication while keeping directional context', () => {
    const source = [
      activity({ id: 'notification', activity_type: 'sms', created_at: '2026-07-31T15:00:00.000Z', description: 'Jay just texted: “Call me” — open CRM' }),
      activity({ id: 'canonical', activity_type: 'sms', created_at: '2026-07-31T14:59:30.000Z', description: 'Call me', metadata: { direction: 'inbound' } }),
    ]

    const normalized = normalizeLeadConversation(source)
    expect(normalized).toHaveLength(1)
    expect(normalized[0].id).toBe('canonical')
    expect(leadActivityText(normalized[0])).toBe('Call me')
  })

  it('excludes tasks and appointments from the communication thread', () => {
    const source = [
      activity({ id: 'task', activity_type: 'task', created_at: '2026-07-31T15:00:00.000Z' }),
      activity({ id: 'appointment', activity_type: 'appointment', created_at: '2026-07-31T14:00:00.000Z' }),
      activity({ id: 'call', activity_type: 'call', created_at: '2026-07-31T13:00:00.000Z' }),
    ]

    expect(normalizeLeadConversation(source).map((item) => item.id)).toEqual(['call'])
  })

  it('turns Howard-like provider rows into one entry per real call', () => {
    const source = [
      activity({ id: 'summary', activity_type: 'note', created_at: '2026-09-14T17:39:10.000Z', description: 'AI Call Analysis: The call was brief and confused.' }),
      activity({ id: 'transcript', activity_type: 'note', created_at: '2026-09-14T17:39:08.000Z', description: 'Call transcript: Hey Howard, what\'s going on?' }),
      activity({ id: 'recording', activity_type: 'call', created_at: '2026-09-14T17:39:04.000Z', description: 'Call recording available', metadata: { source: 'twilio_recording_callback', recordingSid: 'RE123', duration: 758, direction: 'inbound', from: '+19135550101' } }),
      activity({ id: 'inbound', activity_type: 'call', created_at: '2026-09-14T17:39:00.000Z', description: 'Direct inbound call from Howard connected live with Casey — 146s', metadata: { status: 'completed', duration: 146, direction: 'inbound', from: '+19135550101' } }),
      activity({ id: 'no-answer', activity_type: 'call', created_at: '2026-09-14T17:38:21.000Z', description: 'Call: no answer', metadata: { callSid: 'CA123', status: 'no-answer', direction: 'outbound', to: '+19135550101' } }),
      activity({ id: 'provider-status', activity_type: 'call', created_at: '2026-09-14T17:38:20.000Z', description: 'Twilio status: no-answer', metadata: { callSid: 'CA123', status: 'no-answer', direction: 'outbound', to: '+19135550101' } }),
      activity({ id: 'attempted', activity_type: 'call', created_at: '2026-09-14T17:38:10.000Z', description: 'Outbound call to Howard — no answer', metadata: { parentCallSid: 'CA123', status: 'no-answer', direction: 'outbound', to: '+19135550101' } }),
      activity({ id: 'started', activity_type: 'call', created_at: '2026-09-14T17:38:00.000Z', description: 'Outbound call to Howard', metadata: { callSid: 'CA123', event: 'started', direction: 'outbound', to: '+19135550101' } }),
      activity({ id: 'sms-queue', activity_type: 'sms', created_at: '2026-09-14T16:05:00.000Z', description: 'SMS appointment confirmation queued' }),
    ]

    const normalized = normalizeLeadConversation(source)
    const calls = normalized.filter((item) => item.activity_type === 'call')
    const inbound = calls.find((item) => item.metadata?.direction === 'inbound')
    const outbound = calls.find((item) => item.metadata?.direction === 'outbound')

    expect(normalized).toHaveLength(2)
    expect(leadConversationCounts(normalized)).toEqual({ all: 2, call: 2, sms: 0, email: 0, note: 0, voicemail: 0 })
    expect(inbound).toMatchObject({
      description: 'Connected',
      recordingActivityId: 'recording',
      callSummary: 'The call was brief and confused.',
      callTranscript: 'Hey Howard, what\'s going on?',
      metadata: { recordingSid: 'RE123', recordingDuration: 758 },
    })
    expect(outbound).toMatchObject({ description: 'No answer' })
    expect(outbound?.collapsedActivityIds).toHaveLength(4)
  })

  it('formats completed unrecorded call duration as minutes and seconds', () => {
    const normalized = normalizeLeadConversation([
      activity({
        id: 'completed',
        activity_type: 'call',
        created_at: '2026-05-20T17:00:00.000Z',
        description: 'Outbound call to Howard — 169s',
        metadata: { status: 'completed', duration: 169, direction: 'outbound' },
      }),
    ])

    expect(normalized[0].description).toBe('Connected · 2:49')
  })

  it('keeps nearby calls with different provider call IDs separate', () => {
    const normalized = normalizeLeadConversation([
      activity({ id: 'first', activity_type: 'call', created_at: '2026-09-14T17:00:00.000Z', metadata: { callSid: 'CA111', status: 'completed', direction: 'outbound' } }),
      activity({ id: 'second', activity_type: 'call', created_at: '2026-09-14T17:00:10.000Z', metadata: { callSid: 'CA222', status: 'completed', direction: 'outbound' } }),
    ])

    expect(normalized).toHaveLength(2)
  })
})
