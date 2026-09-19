import { NextRequest, NextResponse } from 'next/server'

import {
  MobileAuthError,
  mobileNoStoreHeaders,
  mobileOptionsResponse,
  requireMobileActor,
} from '@/lib/mobile-api/auth'
import { resolveTaskAssignee } from '@/lib/api/task-assignee'
import { transitionWorkItem, WorkItemError, type WorkItemPatch } from '@/lib/server/work-items'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireMobileActor(req)
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Work item id is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }

    const idempotencyKey = req.headers.get('idempotency-key')?.trim() || ''
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      return NextResponse.json({ error: 'A stable Idempotency-Key is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const expectedVersion = typeof body?.expectedVersion === 'number' && Number.isInteger(body.expectedVersion) && body.expectedVersion > 0
      ? body.expectedVersion
      : null
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 500) : ''
    const notes = body?.notes === null
      ? null
      : typeof body?.notes === 'string'
        ? body.notes.trim().slice(0, 5_000) || null
        : undefined
    const dueAt = body?.dueAt === null
      ? null
      : typeof body?.dueAt === 'string' && !Number.isNaN(Date.parse(body.dueAt))
        ? new Date(body.dueAt).toISOString()
        : undefined
    const assignedTo = body?.assignedTo === null
      ? null
      : typeof body?.assignedTo === 'string' && body.assignedTo.trim()
        ? body.assignedTo.trim()
        : undefined

    if (!expectedVersion || !title || dueAt === undefined || assignedTo === undefined) {
      return NextResponse.json({ error: 'expectedVersion, title, dueAt, and assignedTo are required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const assignment = resolveTaskAssignee(assignedTo, actor.name, {
      defaultToActor: false,
      allowUnassigned: true,
    })
    if (!assignment.authorized) {
      return NextResponse.json({ error: 'Work item assignee is not authorized.' }, { status: 403, headers: mobileNoStoreHeaders() })
    }

    const patch: WorkItemPatch = { title, dueAt, assignedTo: assignment.assignedTo ?? null }
    if (notes !== undefined) patch.notes = notes
    const result = await transitionWorkItem({
      key: id,
      actor: actor.name,
      action: 'edit',
      idempotencyKey,
      expectedVersion,
      patch,
    })
    return NextResponse.json(
      { success: true, changed: result.changed, item: result.workItem },
      { headers: mobileNoStoreHeaders() },
    )
  } catch (error) {
    if (error instanceof MobileAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: mobileNoStoreHeaders() })
    }
    if (error instanceof WorkItemError) {
      const status = error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : error.code === 'invalid' ? 400 : 503
      return NextResponse.json({ error: error.message }, { status, headers: mobileNoStoreHeaders() })
    }
    console.error('[mobile/work-items/:id/edit] mutation failed', error)
    return NextResponse.json({ error: 'Work item could not be edited.' }, { status: 503, headers: mobileNoStoreHeaders() })
  }
}
