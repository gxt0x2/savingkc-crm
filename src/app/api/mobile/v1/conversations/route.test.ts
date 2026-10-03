import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), readThreads: vi.fn() }))
vi.mock('@/lib/mobile-api/mobile-command-access', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/mobile-command-access')>(),
  requireMobileCommandActor: mocks.actor,
}))
vi.mock('@/lib/server/conversation-read-model', async (original) => ({
  ...await original<typeof import('@/lib/server/conversation-read-model')>(),
  readConversationThreads: mocks.readThreads,
}))

import { GET } from './route'
import { decodeConversationThreadCursor, encodeConversationThreadCursor } from '@/lib/server/conversation-read-model-contract'

const request = (query = '') => new NextRequest(`https://crm.savingkc.com/api/mobile/v1/conversations${query}`, { headers: { Authorization: 'Bearer token' } })

function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    threadKey: 'lead:11111111-1111-4111-8111-111111111111',
    kind: 'lead',
    attentionState: 'resolved',
    lastActivityAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
}

function page(items: ReturnType<typeof thread>[], hasMore = false) {
  return { items, pageInfo: { limit: 100, hasMore, nextCursor: null }, source: 'projection', degraded: false }
}

describe('mobile conversation list scope and pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ scopedActor: { email: 'casey@savingkc.com', fullName: 'Casey', access: 'agent', assignmentAliases: ['Casey'] } })
    mocks.readThreads.mockResolvedValue(page([]))
  })

  it('filters canonical assigned-agent aliases and never trusts task-owner fallback', async () => {
    mocks.actor.mockResolvedValue({ scopedActor: { email: 'casey@savingkc.com', fullName: 'Casey Jones', access: 'agent', assignmentAliases: ['Casey Jones', 'Casey'] } })
    mocks.readThreads.mockResolvedValue(page([
      thread({ id: '11111111-1111-4111-8111-111111111111', threadKey: 'lead:11111111-1111-4111-8111-111111111111', assigned_agent: ' Casey  Jones ' }),
      thread({ id: '22222222-2222-4222-8222-222222222222', threadKey: 'lead:22222222-2222-4222-8222-222222222222', assigned_agent: null, owner: 'Casey', lastActivityAt: '2026-10-01T11:30:00.000Z' }),
      thread({ id: '33333333-3333-4333-8333-333333333333', threadKey: 'lead:33333333-3333-4333-8333-333333333333', assigned_agent: 'Casey', lastActivityAt: '2026-10-01T11:00:00.000Z' }),
    ]))

    const response = await GET(request('?limit=2'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.readThreads).toHaveBeenCalledWith(expect.objectContaining({ queue: 'all', actorName: null, kind: 'all', timeframe: 'all', limit: 100, messageOnly: true }))
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(['11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333'])
    expect(body.pageInfo).toMatchObject({ limit: 2, hasMore: false, nextCursor: null })
  })

  it('includes stable unmatched display threads for company-wide users', async () => {
    mocks.actor.mockResolvedValue({ scopedActor: { email: 'ernest@savingkc.com', fullName: 'Ernest', access: 'owner', assignmentAliases: [] } })
    mocks.readThreads.mockResolvedValue(page([thread({
      id: 'unmatched:+19135550123',
      threadKey: 'phone:+19135550123',
      kind: 'unmatched',
      full_name: '+19135550123',
      phone: '+19135550123',
      station: 'unmatched',
      source: 'unmatched_activity',
    })]))

    const cursor = encodeConversationThreadCursor({ rank: 1, at: '2026-10-01T11:00:00.000Z', key: 'lead:11111111-1111-4111-8111-111111111111' })
    const response = await GET(request(`?limit=25&cursor=${cursor}`))

    expect(response.status).toBe(200)
    expect(mocks.readThreads).toHaveBeenCalledWith(expect.objectContaining({ queue: 'all', actorName: null, kind: 'all', timeframe: 'all', limit: 100, cursor, messageOnly: true }))
    await expect(response.json()).resolves.toMatchObject({ items: [{ kind: 'unmatched', threadKey: 'phone:+19135550123', source: 'unmatched_activity' }] })
  })

  it('fails closed before reading threads for an unregistered bearer', async () => {
    const { MobileCommandAccessError } = await import('@/lib/mobile-api/mobile-command-access')
    mocks.actor.mockRejectedValue(new MobileCommandAccessError('CRM profile not authorized', 403))
    expect((await GET(request())).status).toBe(403)
    expect(mocks.readThreads).not.toHaveBeenCalled()
  })

  it('scans past pages containing only leads assigned to someone else', async () => {
    mocks.readThreads.mockResolvedValueOnce({
      items: [thread({ id: '11111111-1111-4111-8111-111111111111', threadKey: 'lead:11111111-1111-4111-8111-111111111111', assigned_agent: 'Ernest' })],
      pageInfo: { limit: 100, hasMore: true, nextCursor: 'cursor-after-ernest' }, source: 'projection', degraded: false,
    }).mockResolvedValueOnce({
      items: [thread({ id: '22222222-2222-4222-8222-222222222222', threadKey: 'lead:22222222-2222-4222-8222-222222222222', assigned_agent: 'Casey' })],
      pageInfo: { limit: 100, hasMore: false, nextCursor: null }, source: 'projection', degraded: false,
    })
    const response = await GET(request('?limit=1'))
    const body = await response.json()
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(['22222222-2222-4222-8222-222222222222'])
    expect(mocks.readThreads).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'cursor-after-ernest' }))
  })

  it('rejects invalid cursor page sizes', async () => {
    const response = await GET(request('?limit=101'))
    expect(response.status).toBe(400)
    expect(mocks.readThreads).not.toHaveBeenCalled()
  })

  it('preserves sub-millisecond RPC order and traverses both sides of a page boundary', async () => {
    const newer = thread({ assigned_agent: 'Casey', lastActivityAt: '2026-10-02T12:00:00.123900+00:00' })
    const older = thread({ assigned_agent: 'Casey', id: '22222222-2222-4222-8222-222222222222', threadKey: 'lead:22222222-2222-4222-8222-222222222222', lastActivityAt: '2026-10-02T12:00:00.123100+00:00' })
    mocks.readThreads.mockImplementation(async ({ cursor }) => {
      if (!cursor) return page([newer, older])
      expect(decodeConversationThreadCursor(cursor)?.at).toBe(newer.lastActivityAt)
      return page([older])
    })
    const first = await (await GET(request('?limit=1'))).json()
    expect(first.items.map((item: { id: string }) => item.id)).toEqual([newer.id])
    expect(decodeConversationThreadCursor(first.pageInfo.nextCursor)?.at).toBe(newer.lastActivityAt)
    const second = await (await GET(request(`?limit=1&cursor=${first.pageInfo.nextCursor}`))).json()
    expect(second.items.map((item: { id: string }) => item.id)).toEqual([older.id])
    expect(second.pageInfo.hasMore).toBe(false)
  })

  it('preserves the RPC tie-break ordering instead of locale sorting thread keys', async () => {
    const first = thread({ assigned_agent: 'Casey', id: '22222222-2222-4222-8222-222222222222', threadKey: 'lead:22222222-2222-4222-8222-222222222222' })
    const second = thread({ assigned_agent: 'Casey' })
    mocks.readThreads.mockResolvedValue(page([first, second]))
    const body = await (await GET(request('?limit=1'))).json()
    expect(body.items[0].id).toBe(first.id)
    expect(decodeConversationThreadCursor(body.pageInfo.nextCursor)?.key).toBe(first.threadKey)
  })
})
