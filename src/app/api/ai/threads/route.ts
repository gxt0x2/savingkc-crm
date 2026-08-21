import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { AssistantGenerationError, listAssistantThreads } from '@/lib/ai/generation-store'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  const rawLimit = Number(new URL(request.url).searchParams.get('limit') || 20)
  try {
    const threads = await listAssistantThreads(actor.email, Number.isFinite(rawLimit) ? rawLimit : 20)
    return NextResponse.json({ threads }, { headers: HEADERS })
  } catch (error) {
    if (error instanceof AssistantGenerationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: HEADERS })
    }
    console.error('[ai/threads] list failed', error)
    return NextResponse.json({ error: 'Assistant history is unavailable' }, { status: 503, headers: HEADERS })
  }
}
