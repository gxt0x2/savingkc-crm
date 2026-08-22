import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  conversationDeepLinkSearch,
  conversationMatchesDeepLink,
  fetchConversationHub,
  fetchConversationTimeline,
  mergeConversationThreads,
} from './conversation-hub'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('conversation client read contract', () => {
  it('requests the server-owned queue without sending a client-authored owner', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [],
        pageInfo: { limit: 50, hasMore: false, nextCursor: null },
        source: 'projection',
        degraded: false,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchConversationHub({ queue: 'mine', search: 'seller', cursor: 'next-page' })

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('queue=mine')
    expect(url).toContain('q=seller')
    expect(url).toContain('cursor=next-page')
    expect(url).not.toMatch(/owner|agent/i)
  })

  it('sends the known or unmatched filter only when selected', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], pageInfo: { hasMore: false, nextCursor: null }, source: 'projection', degraded: false }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchConversationHub({ queue: 'needs_reply', kind: 'unmatched' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('kind=unmatched')

    await fetchConversationHub({ queue: 'needs_reply', kind: 'all' })
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('kind=')
  })

  it('preserves compatibility metadata instead of presenting fallback rows as authoritative', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ id: 'lead-1' }],
        pageInfo: { limit: 50, hasMore: true, nextCursor: 'older' },
        source: 'compatibility',
        degraded: true,
        warning: 'Projection unavailable',
      }),
    }))

    const page = await fetchConversationHub<{ id: string }>({ queue: 'all' })

    expect(page).toMatchObject({
      source: 'compatibility',
      degraded: true,
      warning: 'Projection unavailable',
      pageInfo: { hasMore: true, nextCursor: 'older' },
    })
  })

  it('does not send a search term until the server minimum is met', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], pageInfo: { hasMore: false, nextCursor: null }, source: 'projection', degraded: false }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchConversationHub({ queue: 'all', search: 'ab' })

    expect(String(fetchMock.mock.calls[0][0])).not.toContain('q=')
  })

  it('loads a bounded timeline by the server thread id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [],
        pageInfo: { limit: 50, hasMore: false, nextCursor: null },
        source: 'projection',
        degraded: false,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchConversationTimeline({ threadId: '20e2681a-62f8-4b70-afb0-157150d31243' })

    expect(String(fetchMock.mock.calls[0][0])).toContain('threadId=20e2681a-62f8-4b70-afb0-157150d31243')
    expect(String(fetchMock.mock.calls[0][0])).toContain('limit=50')
  })

  it('resolves unmatched deep links through their E.164 search value', () => {
    const requested = 'unmatched:+18164764715'
    expect(conversationDeepLinkSearch(requested)).toBe('phone:+18164764715')
    expect(conversationMatchesDeepLink({
      id: 'unmatched:+18164764715',
      threadKey: 'phone:+18164764715',
    }, requested)).toBe(true)
  })

  it('turns a bare lead UUID into an exact indexed thread search', () => {
    expect(conversationDeepLinkSearch('20e2681a-62f8-4b70-afb0-157150d31243')).toBe('lead:20e2681a-62f8-4b70-afb0-157150d31243')
  })

  it('keeps an out-of-page selection but lets a refreshed server row replace its snapshot', () => {
    type ThreadSnapshot = { threadKey: string; owner: string | null; attentionState: string }
    const pinned: ThreadSnapshot = { threadKey: 'lead:lead-1', owner: null, attentionState: 'needs_reply' }
    expect(mergeConversationThreads<ThreadSnapshot>([], [], pinned)).toEqual([pinned])

    const refreshed: ThreadSnapshot = { threadKey: 'lead:lead-1', owner: 'Casey', attentionState: 'resolved' }
    expect(mergeConversationThreads<ThreadSnapshot>([refreshed], [], pinned)).toEqual([refreshed])
  })
})
