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
})
