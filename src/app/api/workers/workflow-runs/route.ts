export const dynamic = 'force-dynamic'

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { executeNextWorkflowRun, workflowRunPayload, type WorkflowRun } from '@/lib/server/workflow-runs'

export async function POST(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized
  try {
    const body = await request.json().then(workflowRunPayload).catch(() => workflowRunPayload(null))
    const requestedLimit = typeof body.limit === 'number' ? body.limit : 1
    const limit = Math.max(1, Math.min(Math.trunc(requestedLimit), 10))
    const workerId = `workflow-worker:${randomUUID()}`
    const runs: WorkflowRun[] = []
    for (let index = 0; index < limit; index += 1) {
      const run = await executeNextWorkflowRun(workerId)
      if (!run) break
      runs.push(run)
    }
    return NextResponse.json({ processed: runs.length, runs }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (error) {
    console.error('[workflow-runs] worker failed', error)
    return NextResponse.json({ error: 'Workflow worker failed.' }, {
      status: 500,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  }
}
