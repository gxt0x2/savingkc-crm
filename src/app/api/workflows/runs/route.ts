export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  executeWorkflowRun,
  findActiveWorkflowDefinition,
  listWorkflowRuns,
  startWorkflowRun,
  supportsWorkflowExecution,
  workflowRunPayload,
} from '@/lib/server/workflow-runs'

function noStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...init?.headers, 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

export async function GET(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return noStore({ error: 'Unauthorized' }, { status: 401 })
  const rawLimit = Number(new URL(request.url).searchParams.get('limit') || 25)
  try {
    const runs = await listWorkflowRuns(Number.isFinite(rawLimit) ? rawLimit : 25)
    return noStore({ runs, supportedWorkflowIds: ['workflow-registry-health'] })
  } catch (error) {
    console.error('[workflow-runs] list failed', error)
    return noStore({ error: 'Workflow run history is unavailable.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return noStore({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = workflowRunPayload(await request.json())
    const workflowId = typeof body.workflowId === 'string' ? body.workflowId.trim() : ''
    const idempotencyKey = (request.headers.get('idempotency-key') ||
      (typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '')).trim()
    const definition = findActiveWorkflowDefinition(workflowId)
    if (!definition) return noStore({ error: 'Active workflow not found.' }, { status: 404 })
    if (!supportsWorkflowExecution(workflowId)) {
      return noStore({ error: 'This workflow is governed but does not have an approved executor yet.' }, { status: 409 })
    }
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      return noStore({ error: 'A valid Idempotency-Key is required.' }, { status: 400 })
    }
    const maxAttempts = typeof body.maxAttempts === 'number' ? body.maxAttempts : 3
    const run = await startWorkflowRun({
      definition,
      actor: actor.name,
      idempotencyKey,
      triggerKind: 'manual',
      triggerKey: `user:${actor.email}`,
      payload: workflowRunPayload(body.input),
      maxAttempts,
    })
    const executed = run.status === 'queued'
      ? await executeWorkflowRun(run.id, `interactive:${actor.email}`)
      : null
    return noStore({ run: executed ?? run }, { status: 202 })
  } catch (error) {
    console.error('[workflow-runs] start failed', error)
    const detail = error instanceof Error ? error.message : ''
    if (detail.includes('idempotency_conflict')) return noStore({ error: 'That idempotency key belongs to a different workflow run.' }, { status: 409 })
    if (detail.includes('definition_version_conflict')) return noStore({ error: 'This workflow version changed and must be published as a new version.' }, { status: 409 })
    return noStore({ error: 'Workflow run could not start.' }, { status: 500 })
  }
}
