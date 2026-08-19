import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }))

import {
  ConversationReadModelInputError,
  ConversationReadModelUnavailableError,
  conversationPageLimit,
  conversationQueue,
  conversationSearchQuery,
  conversationThreadKey,
  decodeConversationThreadCursor,
  isConversationReadModelMissing,
  readConversationAttention,
  readConversationThreads,
  readConversationTimeline,
} from './conversation-read-model'

function projectionRow(overrides: Record<string, unknown> = {}) {
  return {
    thread_key: 'phone:+19135550123',
    lead_id: null,
    phone: '+19135550123',
    attention_state: 'needs_reply',
    attention_rank: 0,
    owner: null,
    last_channel: 'call',
    last_direction: 'inbound',
    last_communication_id: '00000000-0000-4000-8000-000000000001',
    last_communication_type: 'missed_call',
    last_communication_description: 'Missed call from seller',
    last_communication_agent: 'System',
    last_communication_metadata: {},
    last_communication_at: '2026-08-19T16:00:00.000Z',
    last_activity_at: '2026-08-19T16:00:00.000Z',
    primary_next_action_id: null,
    primary_next_action_title: null,
    primary_next_action_due_at: null,
    primary_next_action_owner: null,
    ...overrides,
  }
}

describe('conversation read model inputs', () => {
  it('keeps list reads bounded and defaults to needs reply', () => {
    expect(conversationPageLimit(null)).toBe(50)
    expect(conversationPageLimit('100')).toBe(100)
    expect(() => conversationPageLimit('101')).toThrow(ConversationReadModelInputError)
    expect(conversationQueue(null)).toBe('needs_reply')
  })

  it('requires indexed search terms and canonicalizes public thread ids', () => {
    expect(conversationSearchQuery('  Jamie   Seller  ')).toBe('Jamie Seller')
    expect(conversationSearchQuery('  50% _Jamie\\Seller  ')).toBe('50 Jamie Seller')
    expect(() => conversationSearchQuery('ab')).toThrow('at least 3')
    expect(() => conversationSearchQuery('%%%')).toThrow('at least 3')
    expect(conversationThreadKey('00000000-0000-4000-8000-000000000001')).toBe(
      'lead:00000000-0000-4000-8000-000000000001',
    )
    expect(conversationThreadKey('unmatched:(913) 555-0123')).toBe('phone:+19135550123')
    expect(conversationThreadKey('phone:(913) 555-0123')).toBe('phone:+19135550123')
    expect(() => conversationThreadKey('lead:not-a-uuid')).toThrow('Invalid lead')
    expect(() => conversationThreadKey('phone:123')).toThrow('Invalid phone')
    expect(() => conversationThreadKey(`lead:${'x'.repeat(201)}`)).toThrow('Invalid threadId')
    const invalidCursor = Buffer.from(JSON.stringify({
      v: 1,
      rank: 0,
      at: '2026-08-19T16:00:00.000Z',
      key: 'phone:123',
    })).toString('base64url')
    expect(() => decodeConversationThreadCursor(invalidCursor)).toThrow('Invalid cursor')
  })

  it('only treats missing projection functions or tables as migration lag', () => {
    expect(isConversationReadModelMissing({ code: 'PGRST202', message: 'function not found' })).toBe(true)
    expect(isConversationReadModelMissing({ code: '42P01', message: 'relation missing' })).toBe(true)
    expect(isConversationReadModelMissing({ code: '42501', message: 'permission denied' })).toBe(false)
  })
})

describe('conversation thread pages', () => {
  it('requests limit plus one, maps unmatched callers, and emits an opaque cursor', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [projectionRow(), projectionRow({
        thread_key: 'phone:+19135550124',
        phone: '+19135550124',
        last_communication_id: '00000000-0000-4000-8000-000000000002',
        last_activity_at: '2026-08-19T15:59:00.000Z',
      })],
      error: null,
    })
    const page = await readConversationThreads(
      { limit: 1, queue: 'all' },
      { rpc } as never,
    )

    expect(rpc).toHaveBeenCalledWith('conversation_thread_page_v1', expect.objectContaining({
      page_limit: 2,
      page_queue: 'all',
    }))
    expect(page).toMatchObject({ source: 'projection', degraded: false, pageInfo: { limit: 1, hasMore: true } })
    expect(page.items[0]).toMatchObject({
      id: 'unmatched:+19135550123',
      threadKey: 'phone:+19135550123',
      kind: 'unmatched',
      attentionState: 'needs_reply',
      lastChannel: 'call',
      lastCallOutcome: { key: 'missed' },
    })
    expect(decodeConversationThreadCursor(page.pageInfo.nextCursor)).toEqual({
      v: 1,
      rank: 0,
      at: '2026-08-19T16:00:00.000Z',
      key: 'phone:+19135550123',
    })
  })

  it('fails closed without scanning source tables when the migration is missing', async () => {
    const db = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } }),
      from: vi.fn(),
    }

    await expect(readConversationThreads({ queue: 'needs_reply' }, db as never))
      .rejects.toBeInstanceOf(ConversationReadModelUnavailableError)
    expect(db.from).not.toHaveBeenCalled()
  })
})

describe('conversation timelines and attention', () => {
  it('uses deterministic cursor parameters and includes typed activity rows', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        id: '00000000-0000-4000-8000-000000000001',
        lead_id: '00000000-0000-4000-8000-000000000002',
        activity_type: 'status_change',
        description: 'Conversation marked read',
        agent: 'Casey',
        metadata: { hub_action: 'mark_read' },
        created_at: '2026-08-19T16:00:00.000Z',
      }, {
        id: '00000000-0000-4000-8000-000000000003',
        lead_id: '00000000-0000-4000-8000-000000000002',
        activity_type: 'missed_call',
        description: 'Missed call',
        agent: 'System',
        metadata: {},
        created_at: '2026-08-19T15:59:00.000Z',
      }, {
        id: '00000000-0000-4000-8000-000000000004',
        lead_id: '00000000-0000-4000-8000-000000000002',
        activity_type: 'email_received',
        description: 'Seller email',
        agent: 'Seller',
        metadata: {},
        created_at: '2026-08-19T15:58:00.000Z',
      }, {
        id: '00000000-0000-4000-8000-000000000005',
        lead_id: '00000000-0000-4000-8000-000000000002',
        activity_type: 'task',
        description: 'Call seller',
        agent: 'Casey',
        metadata: {},
        created_at: '2026-08-19T15:57:00.000Z',
      }],
      error: null,
    })

    const page = await readConversationTimeline({
      threadId: '00000000-0000-4000-8000-000000000002',
      limit: 50,
    }, { rpc } as never)

    expect(rpc).toHaveBeenCalledWith('conversation_timeline_page_v1', {
      target_thread_key: 'lead:00000000-0000-4000-8000-000000000002',
      page_limit: 51,
      before_created_at: null,
      before_activity_id: null,
    })
    expect(page.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ activity_type: 'status_change', kind: 'status', channel: null, direction: null }),
      expect.objectContaining({ activity_type: 'missed_call', kind: 'call', channel: 'call', direction: 'inbound' }),
      expect.objectContaining({ activity_type: 'email_received', kind: 'message', channel: 'email', direction: 'inbound' }),
      expect.objectContaining({ activity_type: 'task', kind: 'task', channel: null, direction: null }),
    ]))
  })

  it('fails attention closed when its canonical projection is missing', async () => {
    await expect(readConversationAttention({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'missing' } }),
    } as never)).rejects.toBeInstanceOf(ConversationReadModelUnavailableError)
  })

  it('fails timeline closed without scanning source tables when the migration is missing', async () => {
    const db = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'missing' } }),
      from: vi.fn(),
    }

    await expect(readConversationTimeline({
      threadId: '00000000-0000-4000-8000-000000000002',
    }, db as never)).rejects.toBeInstanceOf(ConversationReadModelUnavailableError)
    expect(db.from).not.toHaveBeenCalled()
  })
})
