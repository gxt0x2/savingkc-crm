import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  archiveAssistantThread,
  AssistantGenerationError,
  loadAssistantThread,
} from '@/lib/ai/generation-store'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

function failure(error: unknown) {
  if (error instanceof AssistantGenerationError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: HEADERS })
  }
  console.error('[ai/threads/id] request failed', error)
  return NextResponse.json({ error: 'Assistant history is unavailable' }, { status: 503, headers: HEADERS })
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  try {
    const { id } = await context.params
    return NextResponse.json(await loadAssistantThread(actor.email, id), { headers: HEADERS })
  } catch (error) {
    return failure(error)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  const body = await request.json().catch(() => null) as { action?: unknown } | null
  if (body?.action !== 'archive') return NextResponse.json({ error: 'Invalid thread action' }, { status: 400, headers: HEADERS })
  try {
    const { id } = await context.params
    await archiveAssistantThread(actor.email, id)
    return NextResponse.json({ archived: true }, { headers: HEADERS })
  } catch (error) {
    return failure(error)
  }
}
