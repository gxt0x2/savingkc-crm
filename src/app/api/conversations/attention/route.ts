export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import {
  ConversationReadModelUnavailableError,
  readConversationAttention,
} from '@/lib/server/conversation-read-model'

export async function GET() {
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
    const summary = await readConversationAttention()
    return NextResponse.json(summary, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Vary': 'Cookie',
        'X-Conversation-Read-Model': summary.source,
        'X-Conversation-Row-Count': '1',
        'Server-Timing': `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
      },
    })
  } catch (error) {
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
    console.error('[conversations/attention] read failed', error)
    return NextResponse.json(
      { error: 'Conversation attention could not be loaded' },
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
