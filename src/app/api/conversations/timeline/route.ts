export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import {
  ConversationReadModelInputError,
  ConversationReadModelUnavailableError,
  conversationPageLimit,
  readConversationTimeline,
} from '@/lib/server/conversation-read-model'

export async function GET(request: Request) {
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
    const searchParams = new URL(request.url).searchParams
    const threadId = searchParams.get('threadId')?.trim()
    if (!threadId) throw new ConversationReadModelInputError('threadId is required')

    const page = await readConversationTimeline({
      threadId,
      limit: conversationPageLimit(searchParams.get('limit')),
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
    console.error('[conversations/timeline] read failed', error)
    return NextResponse.json(
      { error: 'Conversation timeline could not be loaded' },
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
