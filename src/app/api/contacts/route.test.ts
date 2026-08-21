import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  readSummaries: vi.fn(),
  readDirectoryPage: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: mocks.from, rpc: vi.fn() }),
}))
vi.mock('@/lib/server/contact-workspace-read-model', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/contact-workspace-read-model')>()
  return { ...original, readContactWorkspaceActivitySummaries: mocks.readSummaries }
})
vi.mock('@/lib/server/contact-directory-read-model', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/contact-directory-read-model')>()
  return { ...original, readContactDirectoryPage: mocks.readDirectoryPage }
})

import { GET } from './route'

function orderedQuery(data: unknown[]) {
  const chain = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn() }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.in.mockReturnValue(chain)
  chain.order.mockResolvedValue({ data, error: null })
  return chain
}

function inQuery(data: unknown[]) {
  const chain = { select: vi.fn(), in: vi.fn() }
  chain.select.mockReturnValue(chain)
  chain.in.mockResolvedValue({ data, error: null })
  return chain
}

describe('contacts GET', () => {
  beforeEach(() => {
    mocks.from.mockReset()
    mocks.readSummaries.mockReset()
    mocks.readDirectoryPage.mockReset()

    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return orderedQuery([{
          id: '00000000-0000-0000-0000-000000000001',
          full_name: 'Seller One',
          phone: '+19135550101',
          email: null,
          source: 'website_form',
          station: 'new',
          classification: null,
          dead_reason: null,
          assigned_agent: null,
          property_address: '1 Main St',
          city: 'Kansas City',
          created_at: '2026-08-21T08:00:00.000Z',
          updated_at: '2026-08-21T12:00:00.000Z',
          is_parked: false,
          is_favorite: false,
        }])
      }
      if (table === 'manifests') return orderedQuery([])
      if (table === 'hot_opportunities_cache') return inQuery([])
      throw new Error(`Unexpected table ${table}`)
    })

    mocks.readSummaries.mockResolvedValue(new Map([[
      '00000000-0000-0000-0000-000000000001',
      {
        lead_id: '00000000-0000-0000-0000-000000000001',
        attention_state: 'needs_reply',
        owner: 'Ernest',
        last_communication_id: '10000000-0000-0000-0000-000000000001',
        last_communication_type: 'sms_received',
        last_communication_description: 'Please call me',
        last_communication_agent: 'System',
        last_communication_metadata: { direction: 'inbound' },
        last_communication_at: '2026-08-21T12:00:00.000Z',
        last_activity_at: '2026-08-21T12:00:00.000Z',
        primary_next_action_id: null,
        primary_next_action_title: null,
        primary_next_action_due_at: null,
        primary_next_action_owner: null,
        first_outbound_at: '2026-08-21T09:00:00.000Z',
        has_outbound_attempt: true,
        has_connected_call: true,
        has_inbound_message: true,
        pipeline_intent_activity_type: null,
        pipeline_intent_metadata: null,
      },
    ]]))
  })

  it('hydrates Contacts from the compact projection summary', async () => {
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/contacts?scope=active'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('server-timing')).toContain('activity-summary')
    expect(mocks.readSummaries).toHaveBeenCalledWith(
      ['00000000-0000-0000-0000-000000000001'],
      expect.objectContaining({ from: mocks.from }),
    )
    expect(payload.items).toEqual([
      expect.objectContaining({
        id: '00000000-0000-0000-0000-000000000001',
        owner: 'Ernest',
        attentionState: 'needs_reply',
        lastMessage: 'Please call me',
        firstOutboundAt: '2026-08-21T09:00:00.000Z',
        outreachStatus: 'connected_unclassified',
      }),
    ])
  })

  it('does not depend on the legacy full-history snapshot', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile('src/app/api/contacts/route.ts', 'utf8'))
    expect(source).not.toContain('readConversationActivitySnapshot')
    expect(source).toContain('readContactWorkspaceActivitySummaries')
  })

  it('returns the cursor-bounded directory contract without loading legacy rows', async () => {
    mocks.readDirectoryPage.mockResolvedValue({
      items: [{
        id: '00000000-0000-4000-8000-000000000001',
        full_name: 'Seller One', phone: '+19135550101', email: null,
        source: 'website_form', address: '1 Main St', city: 'Kansas City',
        station: 'new', classification: null, dead_reason: null, owner: 'Ernest',
        score: 81, is_favorite: false, created_at: '2026-08-21T08:00:00.000Z',
        updated_at: '2026-08-21T12:00:00.000Z', pipeline_intent_source: 'website_form',
        attention_state: 'needs_reply', last_communication_id: null,
        last_communication_type: null, last_communication_description: null,
        last_communication_agent: null, last_communication_metadata: {},
        last_communication_at: null, last_activity_at: '2026-08-21T12:00:00.000Z',
        primary_next_action_id: null, primary_next_action_title: null,
        primary_next_action_due_at: null, primary_next_action_owner: null,
        first_outbound_at: null, outreach_status: 'unattempted', manifest: {},
      }],
      totalCount: 1,
      hasMore: false,
      nextCursor: null,
      scopeCounts: { active: 1, prospects: 0, not_leads: 0 },
      smartListCounts: { new: 1, all: 1 },
      facets: { owners: ['Ernest'], sources: ['website_form'], tags: [] },
    })

    const response = await GET(new NextRequest('https://crm.savingkc.com/api/contacts?mode=page&list=new&limit=10'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(payload).toMatchObject({
      items: [expect.objectContaining({ id: '00000000-0000-4000-8000-000000000001', score: 81 })],
      counts: { new: 1, all: 1 },
      pageInfo: { limit: 10, total: 1, hasMore: false, nextCursor: null },
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects malformed page cursors before any database work', async () => {
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/contacts?mode=page&cursor=broken'))
    expect(response.status).toBe(400)
    expect(mocks.readDirectoryPage).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
