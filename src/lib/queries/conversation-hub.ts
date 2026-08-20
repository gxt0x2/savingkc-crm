export const conversationHubStaleTime = 15_000
export const conversationTimelineStaleTime = 10_000
export const conversationHubQueryKey = ['conversation-hub'] as const

export type ConversationQueue = 'needs_reply' | 'mine' | 'unassigned' | 'all'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function conversationDeepLinkSearch(requestedThreadId: string | null): string {
  if (!requestedThreadId) return ''
  const value = requestedThreadId.trim()
  if (value.startsWith('unmatched:')) {
    const unmatched = value.slice('unmatched:'.length)
    return unmatched.startsWith('activity:') ? unmatched : `phone:${unmatched}`
  }
  if (UUID_PATTERN.test(value)) return `lead:${value}`
  return value
}

export function conversationMatchesDeepLink(
  thread: { id: string; threadKey: string },
  requestedThreadId: string,
): boolean {
  if (thread.id === requestedThreadId || thread.threadKey === requestedThreadId) return true
  if (requestedThreadId.startsWith('lead:')) return thread.id === requestedThreadId.slice('lead:'.length)
  return requestedThreadId.startsWith('unmatched:') && thread.id === requestedThreadId
}

export function mergeConversationThreads<T extends { threadKey: string }>(
  freshHead: T[],
  loadedThreads: T[],
  pinnedThread: T | null,
): T[] {
  const seen = new Set<string>()
  return [...freshHead, ...loadedThreads, ...(pinnedThread ? [pinnedThread] : [])].filter((thread) => {
    if (seen.has(thread.threadKey)) return false
    seen.add(thread.threadKey)
    return true
  })
}

export interface ConversationPageInfo {
  nextCursor: string | null
  hasMore: boolean
}

export interface ConversationPage<T> {
  items: T[]
  pageInfo: ConversationPageInfo
  source: string | null
  degraded: boolean
  warning: string | null
}

function pageInfo(value: unknown): ConversationPageInfo {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const nextCursor = typeof input.nextCursor === 'string' && input.nextCursor ? input.nextCursor : null
  return {
    nextCursor,
    hasMore: input.hasMore === true || input.hasNextPage === true || Boolean(nextCursor),
  }
}

async function requiredJson<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' && payload.error ? payload.error : fallback)
  }
  return payload as T
}

export async function fetchConversationHub<T>({
  queue,
  cursor,
  search,
  limit = 50,
}: {
  queue: ConversationQueue
  cursor?: string | null
  search?: string
  limit?: number
}): Promise<ConversationPage<T>> {
  const params = new URLSearchParams({ queue, limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  if ((search?.trim().length ?? 0) >= 3) params.set('q', search!.trim())

  const response = await fetch(`/api/conversations/hub?${params}`, { cache: 'no-store' })
  const payload = await requiredJson<{ items?: T[]; pageInfo?: unknown; source?: unknown; degraded?: unknown; warning?: unknown }>(response, 'Conversation queue could not be loaded')
  return {
    items: payload.items ?? [],
    pageInfo: pageInfo(payload.pageInfo),
    source: typeof payload.source === 'string' ? payload.source : null,
    degraded: payload.degraded === true,
    warning: typeof payload.warning === 'string' && payload.warning ? payload.warning : null,
  }
}

export async function fetchConversationTimeline<T>({
  threadId,
  cursor,
  limit = 50,
}: {
  threadId: string
  cursor?: string | null
  limit?: number
}): Promise<ConversationPage<T>> {
  const params = new URLSearchParams({ threadId, limit: String(limit) })
  if (cursor) params.set('cursor', cursor)

  const response = await fetch(`/api/conversations/timeline?${params}`, { cache: 'no-store' })
  const payload = await requiredJson<{ items?: T[]; pageInfo?: unknown; source?: unknown; degraded?: unknown; warning?: unknown }>(response, 'Conversation timeline could not be loaded')
  return {
    items: payload.items ?? [],
    pageInfo: pageInfo(payload.pageInfo),
    source: typeof payload.source === 'string' ? payload.source : null,
    degraded: payload.degraded === true,
    warning: typeof payload.warning === 'string' && payload.warning ? payload.warning : null,
  }
}
