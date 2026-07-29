import { describe, expect, it } from 'vitest'
import { buildConversationHubThread, type ConversationHubActivity, type ConversationHubLead } from './conversation-hub'

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
