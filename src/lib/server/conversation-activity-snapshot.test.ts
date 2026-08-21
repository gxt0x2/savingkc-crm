import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  range: vi.fn(),
  unstableCache: vi.fn((loader: () => Promise<unknown>) => loader),
}))

vi.mock('server-only', () => ({}))

vi.mock('next/cache', () => ({
  unstable_cache: mocks.unstableCache,
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: mocks.from }),
}))

import {
  CONVERSATION_ACTIVITY_CACHE_TAG,
  isConversationCommunicationActivity,
  isConversationSupportingActivity,
  readConversationActivitySnapshot,
  type ConversationActivitySnapshotRow,
} from './conversation-activity-snapshot'

function activity(overrides: Partial<ConversationActivitySnapshotRow> = {}): ConversationActivitySnapshotRow {
  return {
    id: 'activity-1',
    lead_id: 'lead-1',
    activity_type: 'sms_received',
    description: 'Seller replied',
    agent: null,
    metadata: { direction: 'inbound' },
    created_at: '2026-08-18T15:00:00.000Z',
    ...overrides,
  }
}

function queryChain() {
  const chain = {
    select: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    range: mocks.range,
  }
  chain.select.mockReturnValue(chain)
  chain.in.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  return chain
}

describe('conversation activity snapshot', () => {
  beforeEach(() => {
    mocks.from.mockReset()
    mocks.range.mockReset()
    mocks.from.mockReturnValue(queryChain())
  })

  it('uses a short shared cache window so navigation can reuse one activity scan', () => {
    expect(mocks.unstableCache).toHaveBeenCalledWith(
      expect.any(Function),
      ['conversation-activity-snapshot-v1'],
      { revalidate: 5, tags: [CONVERSATION_ACTIVITY_CACHE_TAG] },
    )
  })

  it('reads every database page without truncating the conversation history', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => activity({ id: `activity-${index}` }))
    const finalPage = [activity({ id: 'activity-final' })]
    mocks.range
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: finalPage, error: null })

    const rows = await readConversationActivitySnapshot()

    expect(rows).toHaveLength(1001)
    const firstQuery = mocks.from.mock.results[0]?.value as ReturnType<typeof queryChain>
    expect(firstQuery.select).toHaveBeenCalledWith(
      'id, lead_id, activity_type, description, agent, metadata, created_at',
    )
    expect(mocks.range).toHaveBeenNthCalledWith(1, 0, 999)
    expect(mocks.range).toHaveBeenNthCalledWith(2, 1000, 1999)
  })

  it('keeps communication and workflow support rows separate for the hub', () => {
    expect(isConversationCommunicationActivity(activity({ activity_type: 'call' }))).toBe(true)
    expect(isConversationCommunicationActivity(activity({ activity_type: 'missed_call' }))).toBe(true)
    expect(isConversationCommunicationActivity(activity({
      activity_type: 'sms',
      metadata: { direction: 'outbound', is_internal: true },
    }))).toBe(false)
    expect(isConversationCommunicationActivity(activity({
      activity_type: 'sms',
      metadata: { direction: 'outbound', queue_contract: 'scheduled_sms_v2' },
    }))).toBe(false)
    expect(isConversationCommunicationActivity(activity({
      activity_type: 'sms',
      description: 'Jamie just texted: “Call me” — open CRM',
      metadata: null,
    }))).toBe(false)
    expect(isConversationCommunicationActivity(activity({ activity_type: 'task' }))).toBe(false)
    expect(isConversationSupportingActivity(activity({ activity_type: 'task' }))).toBe(true)
    expect(isConversationSupportingActivity(activity({ activity_type: 'status_change' }))).toBe(true)
    expect(isConversationSupportingActivity(activity({ activity_type: 'sms_received' }))).toBe(false)
  })
})
