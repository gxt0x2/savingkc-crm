import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireMobileCommandActor: vi.fn(),
  readPage: vi.fn(),
  admin: vi.fn(),
}))

vi.mock('@/lib/mobile-api/mobile-command-access', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/mobile-command-access')>(),
  requireMobileCommandActor: mocks.requireMobileCommandActor,
}))
vi.mock('@/lib/server/contact-directory-read-model', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/contact-directory-read-model')>(),
  readContactDirectoryPage: mocks.readPage,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))

import { GET } from './route'

function request(query = '') {
  return new NextRequest(`https://crm.savingkc.com/api/mobile/v1/leads${query}`, {
    headers: { Authorization: 'Bearer test' },
  })
}

describe('mobile Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMobileCommandActor.mockResolvedValue({ scopedActor: { email: 'ernest@savingkc.com', fullName: 'Ernest', access: 'owner', assignmentAliases: [] } })
    mocks.readPage.mockResolvedValue({
      items: [{
        id: 'lead-1', full_name: 'Morgan Seller', phone: '+18165550100', email: null,
        source: 'website', address: '123 Main St', city: 'Kansas City', station: 'qualified',
        classification: 'opportunity', dead_reason: null, owner: 'Ernest', score: 88,
        is_favorite: true, created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-17T12:00:00Z',
        attention_state: 'needs_reply', last_communication_description: 'Can you call me?',
        last_activity_at: '2026-09-17T12:00:00Z', primary_next_action_id: 'task-1',
        primary_next_action_title: 'Return seller call', primary_next_action_due_at: '2026-09-17T13:00:00Z',
        primary_next_action_owner: 'Ernest',
      }],
      totalCount: 1,
      hasMore: false,
      nextCursor: null,
      smartListCounts: { contacted: 3, qualified: 1, all: 4 },
    })
  })

  it('uses the canonical filtered Pipeline model and returns stage counts', async () => {
    const response = await GET(request('?list=qualified&q=Morgan&limit=50'))

    expect(response.status).toBe(200)
    expect(mocks.readPage).toHaveBeenCalledWith(expect.objectContaining({
      smartList: 'qualified', scope: 'active', search: 'Morgan', limit: 50,
    }))
    await expect(response.json()).resolves.toMatchObject({
      leads: [{ id: 'lead-1', station: 'qualified', last_message: 'Can you call me?' }],
      counts: { contacted: 3, qualified: 1, all: 4 },
      pageInfo: { total: 1, hasMore: false },
    })
  })

  it('defaults unknown lists and clamps page size', async () => {
    await GET(request('?list=legacy&limit=500'))

    expect(mocks.readPage).toHaveBeenCalledWith(expect.objectContaining({
      smartList: 'contacted', limit: 50,
    }))
  })

  it('uses the canonical next-page cursor instead of repeating page one', async () => {
    const cursor = { id: '00000000-0000-4000-8000-000000000001', name: 'Morgan Seller', lastActivityAt: '2026-09-17T12:00:00Z', score: 88, attentionRank: 1 }
    const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64url')
    const response = await GET(request(`?cursor=${encoded}`))
    expect(response.status).toBe(200)
    expect(mocks.readPage).toHaveBeenCalledWith(expect.objectContaining({ cursor }))
  })

  it('rejects malformed cursors before querying the directory', async () => {
    const response = await GET(request('?cursor=not-a-page'))
    expect(response.status).toBe(400)
    expect(mocks.readPage).not.toHaveBeenCalled()
  })

  it('fails closed before loading Pipeline data', async () => {
    const { MobileAuthError } = await import('@/lib/mobile-api/auth')
    mocks.requireMobileCommandActor.mockRejectedValue(new MobileAuthError('Invalid bearer token'))

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mocks.readPage).not.toHaveBeenCalled()
  })

  it('scopes the page and all stage counts before pagination for an agent', async () => {
    mocks.requireMobileCommandActor.mockResolvedValue({ scopedActor: { email: 'casey@savingkc.com', fullName: 'Casey', access: 'agent', assignmentAliases: ['Casey'] } })
    mocks.readPage.mockImplementation(async (query: { smartList: string; owner: string }) => ({
      items: [], totalCount: query.smartList === 'all' ? 2 : 1, hasMore: false, nextCursor: null,
      smartListCounts: { all: 9999, contacted: 9999 },
    }))
    const response = await GET(request('?list=qualified'))
    expect(response.status).toBe(200)
    expect(mocks.readPage).toHaveBeenCalledTimes(7)
    for (const [query] of mocks.readPage.mock.calls) expect(query.owner).toBe('Casey')
    await expect(response.json()).resolves.toMatchObject({ counts: { all: 2, contacted: 1, qualified: 1 }, pageInfo: { total: 1 } })
  })

  it('rejects the directory unassigned sentinel as an operator alias', async () => {
    mocks.requireMobileCommandActor.mockResolvedValue({ scopedActor: { email: 'agent@savingkc.com', fullName: '__unassigned', access: 'agent', assignmentAliases: ['__unassigned'] } })
    expect((await GET(request())).status).toBe(403)
    expect(mocks.readPage).not.toHaveBeenCalled()
  })

  it('attaches an explicit email clear for a stored address with no stop', async () => {
    mocks.admin.mockReturnValue({
      from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
    })
    mocks.readPage.mockResolvedValue({
      items: [{
        id: 'lead-1', full_name: 'Ernest Dodson', phone: '+19137179716', email: 'savingkc@gmail.com',
        source: 'website', address: '123 Main St', city: 'Kansas City', station: 'qualified',
        classification: 'opportunity', dead_reason: null, owner: 'Ernest', score: 88,
        is_favorite: false, created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-17T12:00:00Z',
        attention_state: 'clear', last_communication_description: null,
        last_activity_at: '2026-09-17T12:00:00Z', primary_next_action_id: null,
        primary_next_action_title: null, primary_next_action_due_at: null,
        primary_next_action_owner: null,
      }],
      totalCount: 1, hasMore: false, nextCursor: null, smartListCounts: { qualified: 1 },
    })
    const response = await GET(request('?list=qualified'))
    await expect(response.json()).resolves.toMatchObject({
      leads: [{ email: 'savingkc@gmail.com', email_opt_out: false, email_suppressed: false, email_consent: 'clear' }],
    })
  })
})
