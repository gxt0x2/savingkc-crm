import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  DialerSessionError,
  getDialerAttemptHistory,
  getDialerSession,
  requestPauseDialerSession,
  transitionDialerSession,
} from '@/lib/server/dialer-session-engine'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }

function response(error: unknown) {
  if (error instanceof DialerSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
  console.error('[dialer/sessions/id] Unexpected session failure', error)
  return NextResponse.json({ error: 'Dialer session state is unavailable', code: 'session_engine_unavailable' }, { status: 503, headers: NO_STORE })
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  try {
    const { id } = await context.params
    const searchParams = new URL(request.url).searchParams
    if (searchParams.get('include') === 'attempts') {
      const limitValue = searchParams.get('limit')
      return NextResponse.json(await getDialerAttemptHistory(actor, id, {
        limit: limitValue == null ? undefined : Number(limitValue),
        cursor: searchParams.get('cursor'),
      }), { headers: NO_STORE })
    }
    return NextResponse.json({ session: await getDialerSession(actor, id) }, { headers: NO_STORE })
  } catch (error) {
    return response(error)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE })
  }
  const action = typeof body.action === 'string' ? body.action : ''
  if (!['pause', 'request_pause', 'resume', 'request_stop', 'stop', 'skip'].includes(action)) {
    return NextResponse.json({ error: 'Invalid session action' }, { status: 400, headers: NO_STORE })
  }
  try {
    const { id } = await context.params
    if (action === 'request_pause') {
      return NextResponse.json(await requestPauseDialerSession({
        actor,
        sessionId: id,
        reason: typeof body.reason === 'string' ? body.reason : null,
      }), { headers: NO_STORE })
    }
    const session = await transitionDialerSession({
      actor,
      sessionId: id,
      action: action as 'pause' | 'resume' | 'request_stop' | 'stop' | 'skip',
      reason: typeof body.reason === 'string' ? body.reason : null,
    })
    return NextResponse.json({ session }, { headers: NO_STORE })
  } catch (error) {
    return response(error)
  }
}
