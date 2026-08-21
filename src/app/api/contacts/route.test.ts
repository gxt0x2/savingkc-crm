import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  readSummaries: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: mocks.from, rpc: vi.fn() }),
}))
vi.mock('@/lib/server/contact-workspace-read-model', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/contact-workspace-read-model')>()
  return { ...original, readContactWorkspaceActivitySummaries: mocks.readSummaries }
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
})
