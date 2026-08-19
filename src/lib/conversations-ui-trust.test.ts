import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pageSource = readFileSync('src/app/(app)/conversations/page.tsx', 'utf8')
const threadSource = readFileSync('src/components/conversations/thread-view.tsx', 'utf8')

describe('Conversations V2 client trust contract', () => {
  it('reads queues and timelines from bounded server endpoints', () => {
    expect(pageSource).toContain('fetchConversationHub<ConversationThread>')
    expect(pageSource).toContain('fetchConversationTimeline<ConversationTimelineItem>')
    expect(pageSource).toContain("activeQueue, cursor: pageParam, search: normalizedSearch")
    expect(pageSource).toContain("threadId: activeThread!.id")
    expect(threadSource).toContain('Load earlier activity')
  })

  it('does not query Supabase or invent unread and attention state in the browser', () => {
    for (const forbidden of [
      "@/lib/supabase/client",
      ".from('lead_activities')",
      '.channel(',
      'postgres_changes',
      'unread: isInbound',
      "attentionState: isInbound ? 'needs_reply'",
    ]) {
      expect(pageSource).not.toContain(forbidden)
    }
  })

  it('keeps degraded reads visible and resolves deep links through the All queue', () => {
    expect(pageSource).toContain('Compatibility inbox.')
    expect(threadSource).toContain('Compatibility timeline.')
    expect(pageSource).toContain('useSearchParams()')
    expect(pageSource).not.toContain('window.location.search')
    expect(pageSource).toContain("routeRequestedThread ? 'all' : 'needs_reply'")
    expect(pageSource).toContain("search: requestedThreadSearch, limit: 1")
    expect(pageSource).toContain('selectedThreadKey === resolvedActiveThreadKey')
    expect(pageSource).toContain('setPinnedThread(thread)')
  })

  it('keeps the narrow-screen workspace inbox-first with an explicit back action', () => {
    expect(pageSource).toContain("mobilePane === 'inbox'")
    expect(threadSource).toContain('Back to conversation inbox')
    expect(threadSource).toContain('Complete next action')
    expect(threadSource).toContain('Assign owner')
  })

  it('keeps bounded head refreshes after manual pagination', () => {
    expect(pageSource).toContain("queryKey: ['conversation-hub-head'")
    expect(pageSource).toContain("queryKey: ['conversation-timeline-head'")
    expect(pageSource).toContain('requestedThreadQuery.refetch()')
    expect(pageSource).toContain('selectedQueueThreadQuery.refetch()')
  })

  it('keeps unsupported canned replies out of the sticky composer', () => {
    for (const cannedReply of ['I can call at 2:30', 'Send property details', 'Book appointment']) {
      expect(threadSource).not.toContain(cannedReply)
    }
  })
})
