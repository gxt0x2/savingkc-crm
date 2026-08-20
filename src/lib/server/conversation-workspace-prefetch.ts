import { QueryClient } from '@tanstack/react-query'

import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import {
  conversationHubInfiniteQueryKey,
  conversationTimelineInfiniteQueryKey,
} from '@/lib/queries/conversation-hub'
import {
  readConversationThreads,
  readConversationTimeline,
  type ConversationThreadPage,
  type ConversationTimelinePage,
} from '@/lib/server/conversation-read-model'

type ConversationPrefetchReaders = {
  readThreads: typeof readConversationThreads
  readTimeline: typeof readConversationTimeline
}

const defaultReaders: ConversationPrefetchReaders = {
  readThreads: readConversationThreads,
  readTimeline: readConversationTimeline,
}

export interface ConversationWorkspacePrefetchResult {
  threadCount: number
  timelineCount: number
  hubMs: number
  timelineMs: number
}

type ConversationWorkspaceLoaderDependencies = {
  requireUser: typeof requireAuthenticatedUser
  prefetch: typeof prefetchConversationWorkspace
}

const defaultLoaderDependencies: ConversationWorkspaceLoaderDependencies = {
  requireUser: requireAuthenticatedUser,
  prefetch: prefetchConversationWorkspace,
}

function infiniteData<T>(page: T) {
  return { pages: [page], pageParams: [null] }
}

export async function prefetchConversationWorkspace(
  queryClient: QueryClient,
  readers: ConversationPrefetchReaders = defaultReaders,
): Promise<ConversationWorkspacePrefetchResult> {
  const hubStartedAt = performance.now()
  const hub = await readers.readThreads({ queue: 'needs_reply', limit: 50 })
  const hubMs = performance.now() - hubStartedAt

  queryClient.setQueryData(
    conversationHubInfiniteQueryKey('needs_reply', ''),
    infiniteData<ConversationThreadPage>(hub),
  )

  const firstThread = hub.items[0]
  if (!firstThread) {
    return { threadCount: 0, timelineCount: 0, hubMs, timelineMs: 0 }
  }

  const timelineStartedAt = performance.now()
  const timeline = await readers.readTimeline({ threadId: firstThread.id, limit: 50 })
  const timelineMs = performance.now() - timelineStartedAt

  queryClient.setQueryData(
    conversationTimelineInfiniteQueryKey(firstThread.threadKey),
    infiniteData<ConversationTimelinePage>(timeline),
  )

  return {
    threadCount: hub.items.length,
    timelineCount: timeline.items.length,
    hubMs,
    timelineMs,
  }
}

export async function createConversationWorkspaceQueryClient(
  dependencies: ConversationWorkspaceLoaderDependencies = defaultLoaderDependencies,
): Promise<QueryClient | null> {
  const startedAt = performance.now()
  const unauthorized = await dependencies.requireUser()
  const authMs = performance.now() - startedAt
  if (unauthorized) return null

  const queryClient = new QueryClient()
  try {
    const result = await dependencies.prefetch(queryClient)
    console.info(JSON.stringify({
      level: 'info',
      message: 'Conversations workspace prefetched',
      route: '/conversations',
      authMs: Number(authMs.toFixed(1)),
      hubMs: Number(result.hubMs.toFixed(1)),
      timelineMs: Number(result.timelineMs.toFixed(1)),
      totalMs: Number((performance.now() - startedAt).toFixed(1)),
      threadCount: result.threadCount,
      timelineCount: result.timelineCount,
    }))
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Conversations workspace prefetch failed',
      route: '/conversations',
      totalMs: Number((performance.now() - startedAt).toFixed(1)),
      error: error instanceof Error ? error.message : 'Unknown prefetch error',
    }))
  }
  return queryClient
}
