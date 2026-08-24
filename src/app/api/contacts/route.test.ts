import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  readDirectoryPage: vi.fn(),
  requireUser: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: mocks.from, rpc: vi.fn() }),
}))
vi.mock('@/lib/server/contact-directory-read-model', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/contact-directory-read-model')>()
  return { ...original, readContactDirectoryPage: mocks.readDirectoryPage }
})
vi.mock('@/lib/api/require-authenticated-user', () => ({
  requireAuthenticatedUser: mocks.requireUser,
}))

import { GET, POST } from './route'

describe('contacts GET', () => {
  beforeEach(() => {
    mocks.from.mockReset()
    mocks.readDirectoryPage.mockReset()
    mocks.requireUser.mockReset()
    mocks.requireUser.mockResolvedValue(null)
  })

  it('rejects anonymous reads and creates before CRM access', async () => {
    mocks.requireUser.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const postRequest = new NextRequest('https://crm.savingkc.com/api/contacts', {
      method: 'POST',
      body: JSON.stringify({ fullName: 'Seller' }),
    })
    const parse = vi.spyOn(postRequest, 'json')

    expect((await GET(new NextRequest('https://crm.savingkc.com/api/contacts?mode=page'))).status).toBe(401)
    expect((await POST(postRequest)).status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.readDirectoryPage).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('retires the unbounded compatibility contract without database work', async () => {
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/contacts?scope=active'))
    const payload = await response.json()

    expect(response.status).toBe(410)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(payload.error).toContain('unbounded Contacts contract is retired')
    expect(mocks.readDirectoryPage).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('contains no fallback full-record load', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile('src/app/api/contacts/route.ts', 'utf8'))
    expect(source).not.toContain('readConversationActivitySnapshot')
    expect(source).not.toContain('readContactWorkspaceActivitySummaries')
    expect(source).not.toContain('hot_opportunities_cache')
    expect(source).not.toContain("from('manifests')")
    expect(source).not.toContain('item.manifest')
    expect(source).not.toContain('recommendedActions')
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
        first_outbound_at: null, outreach_status: 'unattempted',
        entity_authority: 'canonical_entities',
      }],
      totalCount: 1,
      hasMore: false,
      nextCursor: null,
      scopeCounts: { active: 1, prospects: 0, not_leads: 0 },
      smartListCounts: { new: 1, all: 1 },
      facets: { owners: ['Ernest'], sources: ['website_form'], tags: [] },
    })

    const response = await GET(new NextRequest('https://crm.savingkc.com/api/contacts?mode=page&list=new&limit=10&tag=probate'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(payload).toMatchObject({
      items: [expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000001',
        score: 81,
        entityAuthority: 'canonical_entities',
      })],
      counts: { new: 1, all: 1 },
      pageInfo: { limit: 10, total: 1, hasMore: false, nextCursor: null },
    })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(payload.items[0]).not.toHaveProperty('nextActivity')
    expect(payload.items[0]).not.toHaveProperty('tags')
    expect(payload.items[0]).not.toHaveProperty('lastContactAt')
    expect(mocks.readDirectoryPage).toHaveBeenCalledWith(
      expect.objectContaining({ tag: '' }),
      expect.anything(),
    )
  })

  it('rejects malformed page cursors before any database work', async () => {
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/contacts?mode=page&cursor=broken'))
    expect(response.status).toBe(400)
    expect(mocks.readDirectoryPage).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
