import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  DialerSessionError,
  getDialerSessionHistory,
  getOpenDialerSession,
  startDialerSession,
} from '@/lib/server/dialer-session-engine'
import { dialerControllerFromRequest, invalidDialerControllerResponse } from '@/lib/api/dialer-controller'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }

function response(error: unknown) {
  if (error instanceof DialerSessionError) return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status, headers: NO_STORE })
  console.error('[dialer/sessions] Unexpected session failure', error)
  return NextResponse.json({ error: 'Dialer session state is unavailable', code: 'session_engine_unavailable' }, { status: 503, headers: NO_STORE })
}
export async function GET(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  try {
    const searchParams = new URL(request.url).searchParams
    if (searchParams.get('scope') === 'history') {
      const limitValue = searchParams.get('limit')
      return NextResponse.json(await getDialerSessionHistory(actor, {
        limit: limitValue == null ? undefined : Number(limitValue),
        cursor: searchParams.get('cursor'),
      }), { headers: NO_STORE })
    }
    return NextResponse.json({ session: await getOpenDialerSession(actor) }, { headers: NO_STORE })
  } catch (error) {
    return response(error)
  }
}

export async function POST(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const controller = dialerControllerFromRequest(request)
  if (!controller) return invalidDialerControllerResponse()
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE })
  }
  try {
    const result = await startDialerSession({
      actor,
      leadIds: Array.isArray(body.leadIds) ? body.leadIds.filter((value): value is string => typeof value === 'string') : [],
      queueKey: typeof body.queueKey === 'string' ? body.queueKey : 'custom',
      callerId: typeof body.callerId === 'string' ? body.callerId : '',
      savedQueueId: typeof body.savedQueueId === 'string' ? body.savedQueueId : null,
      settings: body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings) ? body.settings as Record<string, unknown> : {},
      controllerToken: controller.token,
      controllerLabel: controller.label,
    })
    return NextResponse.json(result, { status: result.created ? 201 : 409, headers: NO_STORE })
  } catch (error) {
    return response(error)
  }
}
