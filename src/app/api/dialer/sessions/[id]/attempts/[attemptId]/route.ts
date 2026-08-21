import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { isReachedDisposition } from '@/lib/dialer-dispositions'
import {
  advanceDialerSessionAfterDisposition,
  DialerSessionError,
  transitionDialerAttempt,
} from '@/lib/server/dialer-session-engine'
import { getDialerPostCallReview } from '@/lib/server/dialer-post-call-review'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }

function response(error: unknown) {
  if (error instanceof DialerSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
  console.error('[dialer/session-attempt] Unexpected attempt failure', error)
  return NextResponse.json({ error: 'Call attempt state could not be saved', code: 'session_engine_unavailable' }, { status: 503, headers: NO_STORE })
}

export async function GET(_request: Request, context: { params: Promise<{ id: string; attemptId: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  try {
    const { id, attemptId } = await context.params
    return NextResponse.json({ review: await getDialerPostCallReview(actor, id, attemptId) }, { headers: NO_STORE })
  } catch (error) {
    return response(error)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; attemptId: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE })
  }
  const action = typeof body.action === 'string' ? body.action : ''
  const { id, attemptId } = await context.params
  try {
    if (action === 'advance') {
      return NextResponse.json({ session: await advanceDialerSessionAfterDisposition({ actor, sessionId: id, clientAttemptId: attemptId }) }, { headers: NO_STORE })
    }
    if (!['started', 'connected', 'ended', 'failed', 'cancelled', 'disposition'].includes(action)) {
      return NextResponse.json({ error: 'Invalid attempt action' }, { status: 400, headers: NO_STORE })
    }
    const disposition = typeof body.disposition === 'string' ? body.disposition.trim() : null
    const durationSeconds = typeof body.durationSeconds === 'number' ? body.durationSeconds : null
    const attempt = await transitionDialerAttempt({
      actor,
      sessionId: id,
      clientAttemptId: attemptId,
      action: action as 'started' | 'connected' | 'ended' | 'failed' | 'cancelled' | 'disposition',
      disposition,
      durationSeconds,
      reached: action === 'disposition' ? isReachedDisposition(disposition) : null,
    })
    return NextResponse.json({ attempt }, { headers: NO_STORE })
  } catch (error) {
    return response(error)
  }
}
