import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireMobileUser: vi.fn(),
  readPage: vi.fn(),
}))

vi.mock('@/lib/mobile-api/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileUser: mocks.requireMobileUser,
}))
vi.mock('@/lib/server/contact-directory-read-model', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/contact-directory-read-model')>(),
  readContactDirectoryPage: mocks.readPage,
}))

import { GET } from './route'

const encodedCursor = Buffer.from(JSON.stringify({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Morgan Seller',
  lastActivityAt: '2026-09-17T12:00:00Z',
  score: 88,
  attentionRank: 1,
})).toString('base64url')

function request(query = '') {
  return new NextRequest(`https://crm.savingkc.com/api/mobile/v1/leads${query}`, {
    headers: { Authorization: 'Bearer test' },
  })
}

describe('mobile Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMobileUser.mockResolvedValue({ user: { email: 'ernest@savingkc.com' } })
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

  it('searches active, prospect, and not-lead scopes without broadening mutation authority', async () => {
    const page = (id: string, name: string, station: string, classification: string | null) => ({
      items: [{
        id, full_name: name, station, classification, last_activity_at: `2026-09-1${id}T12:00:00Z`,
        is_favorite: false, score: 0,
      }],
      totalCount: 1,
      hasMore: false,
      nextCursor: null,
      smartListCounts: { all: 4 },
    })
    mocks.readPage
      .mockResolvedValueOnce(page('1', 'Active Seller', 'contacted', 'lead'))
      .mockResolvedValueOnce(page('2', 'Ernest Prenest', 'new', null))
      .mockResolvedValueOnce(page('3', 'Closed Seller', 'dead', 'dead'))

    const response = await GET(request('?list=all&q=Ernest%20Prenest&limit=50'))

    expect(mocks.readPage).toHaveBeenCalledTimes(3)
    expect(mocks.readPage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      smartList: 'all', scope: 'active', search: 'Ernest Prenest', limit: 50, cursor: null,
    }))
    expect(mocks.readPage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      smartList: 'prospects', scope: 'prospects', search: 'Ernest Prenest', limit: 50, cursor: null,
    }))
    expect(mocks.readPage).toHaveBeenNthCalledWith(3, expect.objectContaining({
      smartList: 'not_leads', scope: 'not_leads', search: 'Ernest Prenest', limit: 50, cursor: null,
    }))
    await expect(response.json()).resolves.toMatchObject({
      leads: [
        { id: '3', station: 'dead' },
        { id: '2', full_name: 'Ernest Prenest', station: 'new' },
        { id: '1', station: 'contacted' },
      ],
      pageInfo: { total: 3, hasMore: false, nextCursor: null },
    })
  })

  it('defaults unknown lists and clamps page size', async () => {
    await GET(request('?list=legacy&limit=500'))

    expect(mocks.readPage).toHaveBeenCalledWith(expect.objectContaining({
      smartList: 'contacted', limit: 50,
    }))
  })

  it('forwards cursor and search without draining every page', async () => {
    await GET(request(`?list=all&limit=25&cursor=${encodedCursor}&q=oak`))

    expect(mocks.readPage).toHaveBeenCalledWith(expect.objectContaining({
      smartList: 'all', cursor: expect.objectContaining({ id: '11111111-1111-4111-8111-111111111111' }), search: 'oak', limit: 25,
    }))
  })

  it('fails closed before loading Pipeline data', async () => {
    const { MobileAuthError } = await import('@/lib/mobile-api/auth')
    mocks.requireMobileUser.mockRejectedValue(new MobileAuthError('Invalid bearer token'))

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mocks.readPage).not.toHaveBeenCalled()
  })
})
