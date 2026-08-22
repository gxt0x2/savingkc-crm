export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import {
  ConversationReadModelInputError,
  ConversationReadModelUnavailableError,
  conversationChannel,
  conversationKindFilter,
  conversationPageLimit,
  conversationQueue,
  conversationSearchQuery,
  readConversationThreads,
} from '@/lib/server/conversation-read-model'

function requestUrl(request?: Request): URL {
  return request ? new URL(request.url) : new URL('https://crm.savingkc.com/api/conversations/hub')
}

export async function GET(request?: Request) {
  const startedAt = performance.now()
  try {
    const unauthorized = await requireAuthenticatedUser()
    if (unauthorized) {
      unauthorized.headers.set('Cache-Control', 'private, no-store')
      unauthorized.headers.set('Server-Timing', `total;dur=${(performance.now() - startedAt).toFixed(1)}`)
      unauthorized.headers.set('X-Conversation-Row-Count', '0')
      unauthorized.headers.set('Vary', 'Cookie')
      return unauthorized
    }
    const searchParams = requestUrl(request).searchParams
    const queue = conversationQueue(searchParams.get('queue'))
    const limit = conversationPageLimit(searchParams.get('limit'))
    const channel = conversationChannel(searchParams.get('channel'))
    const query = conversationSearchQuery(searchParams.get('q'))
    const kind = conversationKindFilter(searchParams.get('kind'))
    let actorName: string | null = null

    if (queue === 'mine') {
      const actor = await resolveAuthenticatedActor()
      if (!actor) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          {
            status: 401,
            headers: {
              'Cache-Control': 'private, no-store',
              'Vary': 'Cookie',
              'X-Conversation-Row-Count': '0',
              'Server-Timing': `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
            },
          },
        )
      }
      actorName = actor.name
    }

    const page = await readConversationThreads({
      limit,
      queue,
      channel,
      query,
      kind,
      actorName,
      cursor: searchParams.get('cursor'),
    })
    return NextResponse.json(page, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Vary': 'Cookie',
        'X-Conversation-Read-Model': page.source,
        'X-Conversation-Row-Count': String(page.items.length),
        'Server-Timing': `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
      },
    })
  } catch (error) {
    if (error instanceof ConversationReadModelInputError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: error.status,
          headers: {
            'Cache-Control': 'private, no-store',
            'Vary': 'Cookie',
            'X-Conversation-Row-Count': '0',
            'Server-Timing': `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
          },
        },
      )
    }
    if (error instanceof ConversationReadModelUnavailableError) {
      return NextResponse.json(
        { error: error.message, code: error.code, retryable: true },
        {
          status: error.status,
          headers: {
            'Cache-Control': 'private, no-store',
            'Vary': 'Cookie',
            'X-Conversation-Row-Count': '0',
            'Server-Timing': `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
          },
        },
      )
    }
    console.error('[conversations/hub] read failed', error)
    return NextResponse.json(
      { error: 'Conversation hub could not be loaded' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'private, no-store',
          'Vary': 'Cookie',
          'X-Conversation-Row-Count': '0',
          'Server-Timing': `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
        },
      },
    )
  }
}
