export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { resolveTaskAssignee } from '@/lib/api/task-assignee'
import { transitionWorkItemsBulk, WorkItemError, type WorkItemPatch } from '@/lib/server/work-items'

type BulkTaskAction = 'complete' | 'reopen' | 'assign' | 'delete'

export async function POST(req: NextRequest) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const ids = Array.from(new Set(
    Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [],
  )).slice(0, 201)
  const action = body.action as BulkTaskAction

  if (ids.length === 0) return NextResponse.json({ success: false, error: 'Select at least one task' }, { status: 400 })
  if (ids.length > 200) return NextResponse.json({ success: false, error: 'Select no more than 200 tasks' }, { status: 400 })
  if (!['complete', 'reopen', 'assign', 'delete'].includes(action)) {
    return NextResponse.json({ success: false, error: 'Unsupported bulk task action' }, { status: 400 })
  }

  const patch: WorkItemPatch = {}
  let canonicalAction: 'complete' | 'reopen' | 'cancel' | 'edit' = action === 'delete'
    ? 'cancel'
    : action === 'assign'
      ? 'edit'
      : action
  if (action === 'assign') {
    const requestedAssignee = body.assignedTo === null || typeof body.assignedTo === 'string' ? body.assignedTo : undefined
    if (requestedAssignee === undefined) {
      return NextResponse.json({ success: false, error: 'Choose an assignee' }, { status: 400 })
    }
    const assignment = resolveTaskAssignee(requestedAssignee, actor.name, { defaultToActor: false })
    if (!assignment.authorized) {
      return NextResponse.json({ success: false, error: 'Task assignee is not authorized' }, { status: 403 })
    }
    canonicalAction = 'edit'
    patch.assignedTo = assignment.assignedTo
  }

  try {
    const result = await transitionWorkItemsBulk({
      keys: ids,
      actor: actor.name,
      action: canonicalAction,
      idempotencyKey: req.headers.get('idempotency-key')?.trim()
        || (typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '')
        || crypto.randomUUID(),
      patch,
    })
    return NextResponse.json({ success: true, changed: result.changed })
  } catch (error) {
    if (error instanceof WorkItemError) {
      const status = error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : error.code === 'invalid' ? 400 : 503
      return NextResponse.json({ success: false, error: error.message }, { status })
    }
    console.error('[calendar/tasks/bulk] canonical mutation failed:', error)
    return NextResponse.json({ success: false, error: 'Bulk task change failed' }, { status: 500 })
  }
}
