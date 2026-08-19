export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { summarizeConversationAttention } from '@/lib/operating-model/conversation-hub'
import { readConversationActivitySnapshot } from '@/lib/server/conversation-activity-snapshot'

export async function GET() {
  try {
    const summary = summarizeConversationAttention(await readConversationActivitySnapshot())
    return NextResponse.json(
      summary,
      { headers: { 'Cache-Control': 'private, max-age=5' } },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Conversation attention could not be loaded' },
      { status: 500 },
    )
  }
}
