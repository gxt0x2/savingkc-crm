import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getSession: vi.fn(),
  timeline: vi.fn(),
  workItems: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))
vi.mock('@/lib/server/dialer-session-engine', () => ({
  DialerSessionError: class DialerSessionError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message) }
  },
  getDialerSession: mocks.getSession,
}))
vi.mock('@/lib/server/conversation-read-model', () => ({ readConversationTimeline: mocks.timeline }))
vi.mock('@/lib/server/work-items', () => ({ listWorkItems: mocks.workItems }))

import { getDialerPreCallBrief } from './dialer-pre-call-brief'

function query(result: { data: unknown; error: unknown }) {
  type MockQuery = PromiseLike<typeof result> & {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    in: ReturnType<typeof vi.fn>
    gte: ReturnType<typeof vi.fn>
    order: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    maybeSingle: ReturnType<typeof vi.fn>
  }
  const builder: MockQuery = {
    select: vi.fn(), eq: vi.fn(), in: vi.fn(), gte: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  for (const method of [builder.select, builder.eq, builder.in, builder.gte, builder.order, builder.limit]) method.mockReturnValue(builder)
  builder.maybeSingle.mockResolvedValue(result)
  return builder
}

describe('server dialer pre-call brief', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ id: 'session-1', currentLeadId: 'lead-1' })
    mocks.timeline.mockResolvedValue({
      items: [{ id: 'activity-1', lead_id: 'lead-1', activity_type: 'sms_received', type: 'sms_received', kind: 'message', channel: 'sms', direction: 'inbound', description: 'Can you call tomorrow?', agent: 'System', metadata: {}, created_at: '2026-08-21T15:00:00Z' }],
      pageInfo: { limit: 20, hasMore: false, nextCursor: null }, source: 'projection', degraded: false,
    })
    mocks.workItems.mockResolvedValue([{ key: 'activity:task-1', sourceKind: 'activity', sourceId: 'task-1', leadId: 'lead-1', tcFileId: null, kind: 'callback', title: 'Confirm price floor', description: 'Ask for the lowest acceptable price.', status: 'pending', priority: 'high', dueAt: '2026-08-23T15:00:00Z', assignedTo: 'Casey', department: 'acquisitions', role: null, primaryNextAction: true, version: 1, sourceCreatedAt: '2026-08-20T00:00:00Z', completedAt: null, updatedAt: '2026-08-20T00:00:00Z' }])
  })

  it('assembles bounded evidence only after verifying session ownership', async () => {
    const lead = query({ data: { id: 'lead-1', full_name: 'Seller One', property_address: '1 Main St', city: 'Kansas City', state: 'MO', zip: '64101', station: 'contacted', priority: 'high', motivation_score: 7, property_condition: null, asking_price: null, opportunity_score: 70, classification: 'opportunity' }, error: null })
    const briefing = query({ data: { situation: 'Inherited property.', motivation: 'Wants a quick close.', strategy: 'Confirm the price floor.', generated_at: '2026-08-20T15:00:00Z' }, error: null })
    const appointment = query({ data: null, error: null })
    const coOwners = query({ data: [{ name: 'Pat Seller' }], error: null })
    mocks.from.mockImplementation((table: string) => ({ leads: lead, briefings: briefing, appointments: appointment, lead_co_owners: coOwners })[table])

    const result = await getDialerPreCallBrief({ email: 'casey@savingkc.com', name: 'Casey' }, 'session-1')

    expect(mocks.getSession).toHaveBeenCalledWith({ email: 'casey@savingkc.com', name: 'Casey' }, 'session-1')
    expect(mocks.timeline).toHaveBeenCalledWith({ threadId: 'lead-1', limit: 20 })
    expect(mocks.workItems).toHaveBeenCalledWith({ leadId: 'lead-1', statuses: ['pending', 'blocked'], limit: 10 })
    expect(result).toMatchObject({
      leadId: 'lead-1',
      objective: { title: 'Confirm price floor', source: 'work_item' },
      aiBriefing: { freshness: 'stale' },
      coOwners: ['Pat Seller'],
      recentEvidence: [{ direction: 'inbound', summary: 'Can you call tomorrow?' }],
    })
    expect(result.questions).toEqual(expect.arrayContaining(['What price would make selling worthwhile?', 'What repairs or updates does the property need?']))
  })

  it('does not query contact data when the session has no current lead', async () => {
    mocks.getSession.mockResolvedValue({ id: 'session-1', currentLeadId: null })
    await expect(getDialerPreCallBrief({ email: 'casey@savingkc.com', name: 'Casey' }, 'session-1')).rejects.toThrow('no current contact')
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.timeline).not.toHaveBeenCalled()
  })
})
