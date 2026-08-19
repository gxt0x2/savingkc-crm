import { describe, expect, it } from 'vitest'
import { buildConversationHubThread, countConversationsNeedingReply, summarizeConversationAttention, type ConversationHubActivity, type ConversationHubLead } from './conversation-hub'

const lead: ConversationHubLead = {
  id: 'lead-1',
  full_name: 'Jamie Seller',
  phone: '+18165551212',
  email: null,
  property_address: '123 Main St',
  city: 'Kansas City',
  station: 'new',
  priority: 'warm',
  assigned_agent: null,
  created_at: '2026-07-28T15:00:00.000Z',
}

function activity(input: Partial<ConversationHubActivity> & Pick<ConversationHubActivity, 'id' | 'activity_type' | 'created_at'>): ConversationHubActivity {
  return {
    lead_id: lead.id,
    description: null,
    agent: 'System',
    metadata: {},
    ...input,
  }
}

describe('conversation hub read model', () => {
  it('surfaces seller intake as needs reply with one primary action', () => {
    const thread = buildConversationHubThread(lead, [
      activity({
        id: 'state-1',
        activity_type: 'status_change',
        created_at: '2026-07-28T15:00:00.000Z',
        metadata: {
          workflow_id: 'seller-form-intake',
          conversation_attention: 'needs_reply',
          owner_name: 'Acquisitions',
        },
      }),
      activity({
        id: 'task-1',
        activity_type: 'task',
        description: 'Make first contact',
        created_at: '2026-07-28T15:00:00.000Z',
        metadata: {
          primary_next_action: true,
          status: 'pending',
          due_date: '2026-07-28T15:05:00.000Z',
          assigned_to: 'Acquisitions',
        },
      }),
    ], new Date('2026-07-28T15:06:00.000Z'))

    expect(thread.attentionState).toBe('needs_reply')
    expect(thread.owner).toBe('Acquisitions')
    expect(thread.primaryNextAction).toMatchObject({
      title: 'Make first contact',
      overdue: true,
    })
  })

  it('uses communication direction instead of a cosmetic unread flag', () => {
    const thread = buildConversationHubThread(lead, [
      activity({
        id: 'inbound',
        activity_type: 'sms',
        description: 'Can you call me?',
        created_at: '2026-07-28T15:10:00.000Z',
        metadata: { direction: 'inbound' },
      }),
      activity({
        id: 'outbound',
        activity_type: 'sms',
        description: 'Yes, calling shortly.',
        created_at: '2026-07-28T15:11:00.000Z',
        metadata: { direction: 'outbound' },
      }),
    ])

    expect(thread.attentionState).toBe('waiting_on_contact')
    expect(thread.unread).toBe(false)
    expect(thread.lastMessage).toBe('Yes, calling shortly.')
    expect(thread.lastChannel).toBe('sms')
  })

  it('treats an inbound contact opt-out as compliance handled, not reply work', () => {
    const thread = buildConversationHubThread(lead, [
      activity({
        id: 'contact-opt-out',
        activity_type: 'sms_received',
        description: 'Stop calling.',
        created_at: '2026-07-28T15:10:00.000Z',
        metadata: { direction: 'inbound' },
      }),
    ])

    expect(thread.attentionState).toBe('resolved')
    expect(thread.unread).toBe(false)
  })

  it('does not request another reply after an inbound call connected', () => {
    const thread = buildConversationHubThread(lead, [
      activity({
        id: 'connected-call',
        activity_type: 'call',
        description: 'Direct inbound call connected live with Ernest',
        created_at: '2026-07-28T15:10:00.000Z',
        metadata: { direction: 'inbound', outcome: 'connected', dialStatus: 'completed' },
      }),
    ])

    expect(thread.attentionState).toBe('resolved')
    expect(thread.unread).toBe(false)
    expect(thread.lastMessage).toBe('Inbound call · Connected')
    expect(thread.lastCallOutcome).toMatchObject({ label: 'Connected', icon: 'phone_in_talk' })
  })

  it('recognizes recorded legacy inbound calls as answered', () => {
    const thread = buildConversationHubThread(lead, [
      activity({
        id: 'legacy-recorded-call',
        activity_type: 'call',
        description: 'Call recording available',
        created_at: '2026-07-28T15:10:00.000Z',
        metadata: { direction: 'inbound', recordingSid: 'RE123' },
      }),
    ])

    expect(thread.attentionState).toBe('resolved')
    expect(thread.unread).toBe(false)
  })

  it('keeps missed inbound calls actionable until the agent returns them', () => {
    const missed = activity({
      id: 'missed-call',
      activity_type: 'call',
      description: 'Inbound call: no answer',
      created_at: '2026-07-28T15:10:00.000Z',
      metadata: { direction: 'inbound', outcome: 'missed', dialStatus: 'no-answer' },
    })

    expect(buildConversationHubThread(lead, [missed]).attentionState).toBe('needs_reply')
    expect(buildConversationHubThread(lead, [missed]).lastMessage).toBe('Inbound call · No answer')

    const returned = activity({
      id: 'returned-call',
      activity_type: 'call',
      description: 'Outbound call returned by Ernest',
      created_at: '2026-07-28T15:12:00.000Z',
      metadata: { direction: 'outbound', outcome: 'connected' },
    })

    expect(buildConversationHubThread(lead, [missed, returned]).attentionState).toBe('waiting_on_contact')
  })

  it('exposes the most recent communication channel for inbox filters', () => {
    const thread = buildConversationHubThread(lead, [
      activity({
        id: 'email',
        activity_type: 'email',
        description: 'Offer details',
        created_at: '2026-07-28T15:13:00.000Z',
        metadata: { direction: 'outbound' },
      }),
      activity({
        id: 'older-call',
        activity_type: 'call',
        created_at: '2026-07-28T15:10:00.000Z',
        metadata: { direction: 'inbound' },
      }),
    ])

    expect(thread.lastChannel).toBe('email')
  })

  it('honors an explicit read action only when it is newer than communication', () => {
    const thread = buildConversationHubThread(lead, [
      activity({
        id: 'inbound',
        activity_type: 'sms',
        created_at: '2026-07-28T15:10:00.000Z',
        metadata: { direction: 'inbound' },
      }),
      activity({
        id: 'read',
        activity_type: 'status_change',
        created_at: '2026-07-28T15:12:00.000Z',
        metadata: { hub_action: 'mark_read' },
      }),
    ])

    expect(thread.attentionState).toBe('resolved')
  })

  it('counts only lead conversations whose current state needs a reply', () => {
    const inbound = activity({
      id: 'inbound-needs-reply',
      lead_id: 'lead-needs-reply',
      activity_type: 'sms_received',
      created_at: '2026-07-28T15:10:00.000Z',
      metadata: { direction: 'inbound' },
    })
    const resolvedInbound = activity({
      id: 'resolved-inbound',
      lead_id: 'lead-resolved',
      activity_type: 'sms_received',
      created_at: '2026-07-28T15:10:00.000Z',
      metadata: { direction: 'inbound' },
    })
    const explicitRead = activity({
      id: 'explicit-read',
      lead_id: 'lead-resolved',
      activity_type: 'status_change',
      created_at: '2026-07-28T15:11:00.000Z',
      metadata: { hub_action: 'mark_read' },
    })
    const unmatched = activity({
      id: 'unmatched-inbound',
      lead_id: null,
      activity_type: 'sms_received',
      created_at: '2026-07-28T15:12:00.000Z',
      metadata: { direction: 'inbound' },
    })

    expect(countConversationsNeedingReply([inbound, resolvedInbound, explicitRead, unmatched])).toBe(1)
  })

  it('summarizes every inbound channel and overdue work without counting unmatched activity', () => {
    const email = activity({
      id: 'email-inbound',
      lead_id: 'lead-email',
      activity_type: 'email_received',
      created_at: '2026-08-18T14:00:00.000Z',
      metadata: {},
    })
    const text = activity({
      id: 'text-inbound',
      lead_id: 'lead-text',
      activity_type: 'sms_inbound',
      created_at: '2026-08-18T14:05:00.000Z',
      metadata: {},
    })
    const call = activity({
      id: 'call-inbound',
      lead_id: 'lead-call',
      activity_type: 'voicemail',
      created_at: '2026-08-18T14:10:00.000Z',
      metadata: {},
    })
    const overdueTask = activity({
      id: 'task-overdue',
      lead_id: 'lead-call',
      activity_type: 'task',
      created_at: '2026-08-18T14:11:00.000Z',
      metadata: {
        primary_next_action: true,
        status: 'pending',
        due_date: '2026-08-18T14:30:00.000Z',
      },
    })

    expect(summarizeConversationAttention(
      [email, text, call, overdueTask],
      new Date('2026-08-18T15:00:00.000Z'),
    )).toEqual({ needsReply: 3, calls: 1, emails: 1, texts: 1, overdue: 1 })
  })

  it('prefers a claimed agent over workflow team ownership', () => {
    const thread = buildConversationHubThread(
      { ...lead, assigned_agent: 'Ernest' },
      [activity({
        id: 'state-1',
        activity_type: 'status_change',
        created_at: '2026-07-28T15:00:00.000Z',
        metadata: {
          workflow_id: 'seller-form-intake',
          owner_name: 'Acquisitions',
        },
      })],
    )

    expect(thread.owner).toBe('Ernest')
  })

  it('removes completed primary actions from the active task slot', () => {
    const thread = buildConversationHubThread(lead, [
      activity({
        id: 'task-1',
        activity_type: 'task',
        description: 'Make first contact',
        created_at: '2026-07-28T15:00:00.000Z',
        metadata: {
          primary_next_action: true,
          status: 'completed',
          assigned_to: 'Acquisitions',
        },
      }),
    ])

    expect(thread.primaryNextAction).toBeNull()
  })
})
