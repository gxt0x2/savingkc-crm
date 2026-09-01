import { NextResponse } from 'next/server'

import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { dialerControllerFromRequest, invalidDialerControllerResponse } from '@/lib/api/dialer-controller'
import {
  assertDialerSessionControlOperation,
  beginDialerSessionControlOperation,
  DialerSessionError,
  endDialerSessionControlOperation,
} from '@/lib/server/dialer-session-engine'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function errorResponse(error: unknown) {
  if (error instanceof DialerSessionError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status: error.status, headers: NO_STORE },
    )
  }
  console.error('[dialer/session-control-operation] Unexpected operation failure', error)
  return NextResponse.json(
    { error: 'Dialing-session change authorization is unavailable', code: 'session_control_unavailable' },
    { status: 503, headers: NO_STORE },
  )
}

async function input(request: Request): Promise<{ operationId: string; label?: string } | null> {
  try {
    const body = await request.json() as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    const record = body as Record<string, unknown>
    const operationId = typeof record.operationId === 'string' ? record.operationId.trim() : ''
    if (!UUID_PATTERN.test(operationId)) return null
    return { operationId, label: typeof record.label === 'string' ? record.label.trim() : undefined }
  } catch {
    return null
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const controller = dialerControllerFromRequest(request)
  if (!controller) return invalidDialerControllerResponse()
  const body = await input(request)
  if (!body?.label || body.label.length > 120) {
    return NextResponse.json({ error: 'Invalid dialing-session operation' }, { status: 400, headers: NO_STORE })
  }
  try {
    const { id } = await context.params
    return NextResponse.json(await beginDialerSessionControlOperation({
      actor,
      sessionId: id,
      controllerToken: controller.token,
      operationId: body.operationId,
      label: body.label,
    }), { headers: NO_STORE })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const controller = dialerControllerFromRequest(request)
  if (!controller) return invalidDialerControllerResponse()
  const body = await input(request)
  if (!body) {
    return NextResponse.json({ error: 'Invalid dialing-session operation' }, { status: 400, headers: NO_STORE })
  }
  try {
    const { id } = await context.params
    return NextResponse.json(await endDialerSessionControlOperation({
      actor,
      sessionId: id,
      controllerToken: controller.token,
      operationId: body.operationId,
    }), { headers: NO_STORE })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const controller = dialerControllerFromRequest(request)
  if (!controller) return invalidDialerControllerResponse()
  const body = await input(request)
  if (!body) {
    return NextResponse.json({ error: 'Invalid dialing-session operation' }, { status: 400, headers: NO_STORE })
  }
  try {
    const { id } = await context.params
    await assertDialerSessionControlOperation({
      actor,
      sessionId: id,
      controllerToken: controller.token,
      operationId: body.operationId,
    })
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  } catch (error) {
    return errorResponse(error)
  }
}
