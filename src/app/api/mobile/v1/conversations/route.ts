import { NextRequest, NextResponse } from 'next/server'

import { assistantActorCanReadCompanyWide } from '@/lib/assistant/auth'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { MobileCommandAccessError, requireMobileCommandActor } from '@/lib/mobile-api/mobile-command-access'
import { mobileActorCanReadAssignedLead } from '@/lib/mobile-api/authorized-lead'
import {
  ConversationReadModelInputError,
  ConversationReadModelUnavailableError,
  conversationPageLimit,
  readConversationThreads,
} from '@/lib/server/conversation-read-model'
import { encodeConversationThreadCursor } from '@/lib/server/conversation-read-model-contract'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

function attentionRank(state: unknown): number {
  if (state === 'needs_reply') return 0
  if (state === 'waiting_on_contact') return 1
  return 2
}

export async function GET(req: NextRequest) {
  try {
    const { scopedActor } = await requireMobileCommandActor(req)
    const url = new URL(req.url)
    const limit = conversationPageLimit(url.searchParams.get('limit'))
    const cursor = url.searchParams.get('cursor')
    const companyWide = assistantActorCanReadCompanyWide(scopedActor)
    if (!companyWide && !scopedActor.assignmentAliases.length) return NextResponse.json({ error: 'CRM assignment unavailable' }, { status: 403, headers: mobileNoStoreHeaders() })

    // Use the message-first CRM projection. It pages by latest communication,
    // includes unmatched inbound threads, and does not select leads by age or
    // pipeline stage before checking their activity.
    // Scan the canonical global ordering, then authorize matched leads from
    // `leads.assigned_agent`. The projection's `owner` may fall back to a task
    // owner and is not a safe access-control source. A single global cursor
    // also keeps pages correct when a trusted login has multiple name aliases.
    const items = [] as Awaited<ReturnType<typeof readConversationThreads>>['items']
    const byThread = new Map<string, (typeof items)[number]>()
    let scanCursor = cursor
    let hasMore = false
    let source: 'projection' | 'compatibility' = 'projection'
    let degraded = false
    let warning: string | undefined
    do {
      const page = await readConversationThreads({
        limit: 100,
        cursor: scanCursor,
        queue: 'all',
        actorName: null,
        kind: 'all',
        timeframe: 'all',
        messageOnly: true,
        messageActorAliases: companyWide ? [] : scopedActor.assignmentAliases,
        messageCompanyWide: companyWide,
      })
      source = page.source
      degraded ||= page.degraded
      warning ??= page.warning
      for (const item of page.items) {
        const allowed = companyWide
          ? true
          : item.kind === 'lead' && mobileActorCanReadAssignedLead(scopedActor, item.assigned_agent)
        if (allowed && !byThread.has(item.threadKey)) byThread.set(item.threadKey, item)
      }
      // Preserve RPC ordering, including PostgreSQL timestamp microseconds and
      // database collation. JS Date/locale sorting changes keyset boundaries.
      const ordered = [...byThread.values()]
      if (ordered.length >= limit) {
        items.push(...ordered.slice(0, limit))
        // The cursor belongs to the last returned item. Any later eligible
        // items fetched during this scan will be returned on the next request.
        const last = items.at(-1)
        hasMore = Boolean(last && (page.pageInfo.hasMore || ordered.length > limit))
        break
      }
      hasMore = page.pageInfo.hasMore
      if (!hasMore) {
        items.push(...ordered)
        break
      }
      if (!page.pageInfo.nextCursor || page.pageInfo.nextCursor === scanCursor) {
        throw new Error('Conversation cursor did not advance')
      }
      scanCursor = page.pageInfo.nextCursor
    } while (hasMore)
    const last = items.at(-1)
    const nextCursor = hasMore && last
      ? encodeConversationThreadCursor({
        rank: attentionRank(last.attentionState),
        at: last.lastActivityAt,
        key: last.threadKey,
      })
      : null

    return NextResponse.json({
      items,
      pageInfo: { limit, hasMore: Boolean(nextCursor), nextCursor },
      source,
      degraded,
      ...(warning ? { warning } : {}),
    }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError || error instanceof MobileCommandAccessError
      ? error.status
      : error instanceof ConversationReadModelInputError
        ? error.status
        : error instanceof ConversationReadModelUnavailableError
          ? error.status
          : 500
    const message = error instanceof MobileAuthError || error instanceof MobileCommandAccessError
      || error instanceof ConversationReadModelInputError || error instanceof ConversationReadModelUnavailableError
      ? error.message
      : 'Conversations could not be loaded.'
    return NextResponse.json({ error: message, ...(error instanceof ConversationReadModelUnavailableError ? { code: error.code, retryable: true } : {}) }, {
      status,
      headers: mobileNoStoreHeaders(),
    })
  }
}
