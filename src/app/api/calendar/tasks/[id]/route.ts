export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { resolveTaskAssignee } from '@/lib/api/task-assignee'
import { normalizeWorkItemKind, transitionWorkItem, WorkItemError, type WorkItemPatch } from '@/lib/server/work-items'
import { normalizeTaskActivityPatch } from '@/lib/tasks/task-activity'

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof WorkItemError) {
    const status = error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : error.code === 'invalid' ? 400 : 503
    return NextResponse.json({ success: false, error: error.message }, { status })
  }
  console.error('[calendar/tasks/:id] canonical mutation failed:', error)
  return NextResponse.json({ success: false, error: fallback }, { status: 500 })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ success: false, error: 'Task id is required' }, { status: 400 })

  let input: unknown
  try {
    input = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const patch = normalizeTaskActivityPatch(input)
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ success: false, error: 'No supported task changes were provided' }, { status: 400 })
  }
  if (patch.title !== undefined && !patch.title) {
    return NextResponse.json({ success: false, error: 'Task title is required' }, { status: 400 })
  }

  const workItemPatch: WorkItemPatch = {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.taskType !== undefined ? { kind: normalizeWorkItemKind(patch.taskType) } : {}),
    ...(patch.dueDate !== undefined ? { dueAt: patch.dueDate } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
  }
  if (patch.assignedTo !== undefined) {
    const assignment = resolveTaskAssignee(patch.assignedTo, actor.name, { defaultToActor: false, allowUnassigned: true })
    if (!assignment.authorized) {
      return NextResponse.json({ success: false, error: 'Task assignee is not authorized' }, { status: 403 })
    }
    workItemPatch.assignedTo = assignment.assignedTo
  }

  try {
    const body = input as Record<string, unknown>
    const result = await transitionWorkItem({
      key: id,
      actor: actor.name,
      action: 'edit',
      idempotencyKey: req.headers.get('idempotency-key')?.trim()
        || (typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '')
        || crypto.randomUUID(),
      expectedVersion: typeof body.expectedVersion === 'number' ? body.expectedVersion : null,
      patch: workItemPatch,
    })
    return NextResponse.json({ success: true, changed: result.changed, taskId: result.workItem.key, version: result.workItem.version })
  } catch (error) {
    return errorResponse(error, 'Task could not be updated')
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ success: false, error: 'Task id is required' }, { status: 400 })

  try {
    const result = await transitionWorkItem({
      key: id,
      actor: actor.name,
      action: 'cancel',
      idempotencyKey: req.headers.get('idempotency-key')?.trim() || crypto.randomUUID(),
    })
    return NextResponse.json({ success: true, changed: result.changed, taskId: result.workItem.key, version: result.workItem.version })
  } catch (error) {
    return errorResponse(error, 'Task could not be cancelled')
  }
}
