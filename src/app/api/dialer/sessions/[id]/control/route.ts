import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { dialerControllerFromRequest, invalidDialerControllerResponse } from '@/lib/api/dialer-controller'
import {
  claimDialerSessionControl,
  DialerSessionError,
  heartbeatDialerSessionControl,
} from '@/lib/server/dialer-session-engine'
import { disconnectProviderCallForTakeover } from '@/lib/server/dialer-provider-call-control'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }

function response(error: unknown) {
  if (error instanceof DialerSessionError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status: error.status, headers: NO_STORE },
    )
  }
  console.error('[dialer/session-control] Unexpected control failure', error)
  return NextResponse.json(
    { error: 'Dialing control is unavailable', code: 'session_control_unavailable' },
    { status: 503, headers: NO_STORE },
  )
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const controller = dialerControllerFromRequest(request)
  if (!controller) return invalidDialerControllerResponse()
  try {
    const { id } = await context.params
    const body = await request.json().catch(() => null) as { userActive?: unknown } | null
    return NextResponse.json(await heartbeatDialerSessionControl({
      actor,
      sessionId: id,
      controllerToken: controller.token,
      userActive: body?.userActive === true,
    }), { headers: NO_STORE })
  } catch (error) {
    return response(error)
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const controller = dialerControllerFromRequest(request)
  if (!controller) return invalidDialerControllerResponse()
  let body: Record<string, unknown>
  try {
    const candidate = await request.json() as unknown
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE })
    }
    body = candidate as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE })
  }
  const expectedGeneration = body.expectedGeneration
  if (body.action !== 'takeover' || typeof expectedGeneration !== 'number' || !Number.isInteger(expectedGeneration) || expectedGeneration < 0) {
    return NextResponse.json({ error: 'Invalid session control request' }, { status: 400, headers: NO_STORE })
  }
  try {
    const { id } = await context.params
    const result = await claimDialerSessionControl({
      actor,
      sessionId: id,
      controllerToken: controller.token,
      controllerLabel: controller.label,
      force: true,
      expectedGeneration,
      requestId: typeof body.requestId === 'string' ? body.requestId : null,
    })
    const providerDisconnect = await disconnectProviderCallForTakeover(
      result.interruptedAttempt?.providerCallSid,
    )
    const { interruptedAttempt, ...publicResult } = result
    return NextResponse.json({
      ...publicResult,
      interruption: interruptedAttempt ? {
        recorded: true,
        priorStatus: interruptedAttempt.status,
        providerDisconnect,
      } : null,
    }, { headers: NO_STORE })
  } catch (error) {
    return response(error)
  }
}
