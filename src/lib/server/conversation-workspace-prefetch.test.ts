import { QueryClient } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import {
  conversationHubInfiniteQueryKey,
  conversationTimelineInfiniteQueryKey,
} from '@/lib/queries/conversation-hub'
import type {
  ConversationThreadPage,
  ConversationTimelinePage,
} from '@/lib/server/conversation-read-model'
import {
  createConversationWorkspaceQueryClient,
  prefetchConversationWorkspace,
} from './conversation-workspace-prefetch'

const hubPage = {
  items: [{ id: 'lead-1', threadKey: 'lead:lead-1' }],
  pageInfo: { limit: 50, hasMore: false, nextCursor: null },
  source: 'projection',
  degraded: false,
} as ConversationThreadPage

const timelinePage = {
  threadId: 'lead-1',
  threadKey: 'lead:lead-1',
  items: [{ id: 'activity-1' }],
  pageInfo: { limit: 50, hasMore: false, nextCursor: null },
  source: 'projection',
  degraded: false,
} as ConversationTimelinePage

describe('prefetchConversationWorkspace', () => {
  it('keeps Vercel compute colocated with the Supabase us-west-2 database', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { regions?: string[] }
    expect(vercel.regions).toEqual(['pdx1'])
  })

  it('hydrates the default inbox and selected timeline with the client query keys', async () => {
    const queryClient = new QueryClient()
    const readThreads = vi.fn().mockResolvedValue(hubPage)
    const readTimeline = vi.fn().mockResolvedValue(timelinePage)

    const result = await prefetchConversationWorkspace(queryClient, { readThreads, readTimeline })

    expect(readThreads).toHaveBeenCalledWith({ queue: 'needs_reply', limit: 50 })
    expect(readTimeline).toHaveBeenCalledWith({ threadId: 'lead-1', limit: 50 })
    expect(queryClient.getQueryData(conversationHubInfiniteQueryKey('needs_reply', ''))).toEqual({
      pages: [hubPage],
      pageParams: [null],
    })
    expect(queryClient.getQueryData(conversationTimelineInfiniteQueryKey('lead:lead-1'))).toEqual({
      pages: [timelinePage],
      pageParams: [null],
    })
    expect(result).toEqual(expect.objectContaining({ threadCount: 1, timelineCount: 1 }))
  })

  it('does not request a timeline when the inbox is empty', async () => {
    const queryClient = new QueryClient()
    const emptyHub = { ...hubPage, items: [] }
    const readThreads = vi.fn().mockResolvedValue(emptyHub)
    const readTimeline = vi.fn()

    await expect(prefetchConversationWorkspace(queryClient, { readThreads, readTimeline }))
      .resolves.toEqual(expect.objectContaining({ threadCount: 0, timelineCount: 0 }))
    expect(readTimeline).not.toHaveBeenCalled()
  })

  it('does not create or populate a cache when authentication fails', async () => {
    const requireUser = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    const prefetch = vi.fn()

    await expect(createConversationWorkspaceQueryClient({ requireUser, prefetch })).resolves.toBeNull()
    expect(prefetch).not.toHaveBeenCalled()
  })
})
