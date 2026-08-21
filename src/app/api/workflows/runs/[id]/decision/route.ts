export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { decideWorkflowRun, executeWorkflowRun, workflowRunPayload } from '@/lib/server/workflow-runs'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized
  try {
    const [{ id }, body, actor] = await Promise.all([
      context.params,
      request.json().then(workflowRunPayload),
      resolveAuthenticatedActor(),
    ])
    const decision = body.decision === 'approved' || body.decision === 'rejected' ? body.decision : null
    const idempotencyKey = (request.headers.get('idempotency-key') ||
      (typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '')).trim()
    if (!decision) return NextResponse.json({ error: 'Decision must be approved or rejected.' }, { status: 400 })
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      return NextResponse.json({ error: 'A valid Idempotency-Key is required.' }, { status: 400 })
    }
    const run = await decideWorkflowRun({
      runId: id,
      decision,
      idempotencyKey,
      actor: actor?.name || 'Authorized automation',
      note: typeof body.note === 'string' ? body.note : null,
    })
    const executed = decision === 'approved' && run.status === 'queued'
      ? await executeWorkflowRun(run.id, `approval:${actor?.email || 'automation'}`)
      : null
    return NextResponse.json({ run: executed ?? run }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (error) {
    console.error('[workflow-runs] decision failed', error)
    const detail = error instanceof Error ? error.message : ''
    const conflict = detail.includes('idempotency_conflict') || detail.includes('not_awaiting_approval')
    return NextResponse.json({ error: conflict ? 'This workflow decision conflicts with its current state.' : 'Workflow decision failed.' }, {
      status: conflict ? 409 : 500,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  }
}
