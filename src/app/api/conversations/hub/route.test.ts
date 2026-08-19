import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  readActivitySnapshot: vi.fn(),
  unstableCache: vi.fn((loader: () => Promise<unknown>) => loader),
}))

vi.mock('server-only', () => ({}))

vi.mock('next/cache', () => ({
  unstable_cache: mocks.unstableCache,
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: mocks.from }),
}))

vi.mock('@/lib/server/conversation-activity-snapshot', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/conversation-activity-snapshot')>(
    '@/lib/server/conversation-activity-snapshot',
  )
  return {
    ...actual,
    readConversationActivitySnapshot: mocks.readActivitySnapshot,
  }
})

import { GET } from './route'

describe('conversation hub API', () => {
  beforeEach(() => {
    mocks.from.mockReset()
    mocks.readActivitySnapshot.mockReset()
  })

  it('builds the hub from the shared snapshot without another activity query', async () => {
    mocks.readActivitySnapshot.mockResolvedValue([
      {
        id: 'message-1',
        lead_id: 'lead-1',
        activity_type: 'sms_received',
        type: null,
        description: 'Can you call me?',
        agent: null,
        metadata: { direction: 'inbound' },
        created_at: '2026-08-18T15:00:00.000Z',
      },
      {
        id: 'task-1',
        lead_id: 'lead-1',
        activity_type: 'task',
        type: null,
        description: 'Return seller call',
        agent: null,
        metadata: {
          primary_next_action: true,
          status: 'pending',
          due_date: '2026-08-18T16:00:00.000Z',
        },
        created_at: '2026-08-18T15:01:00.000Z',
      },
    ])

    mocks.from.mockImplementation((table: string) => ({
      select: vi.fn(() => ({
        in: vi.fn(async () => table === 'leads'
          ? {
              data: [{
                id: 'lead-1',
                full_name: 'Jordan Seller',
                phone: '+19135550123',
                email: null,
                property_address: '123 Test Street',
                city: 'Kansas City',
                county: 'Jackson',
                station: 'new',
                priority: 'warm',
                assigned_agent: 'Casey',
                classification: 'lead',
                dead_reason: null,
                source: 'website_form',
                motivation_score: null,
                arv: null,
                offer_amount: null,
                appointment_date: null,
                created_at: '2026-08-18T14:00:00.000Z',
              }],
              error: null,
            }
          : { data: [], error: null }),
      })),
    }))

    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0]).toMatchObject({
      id: 'lead-1',
      attentionState: 'needs_reply',
      primaryNextAction: { id: 'task-1', title: 'Return seller call' },
    })
    expect(mocks.from).toHaveBeenCalledTimes(2)
    expect(mocks.from).not.toHaveBeenCalledWith('lead_activities')
  })
})
