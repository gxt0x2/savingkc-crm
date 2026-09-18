import { NextRequest, NextResponse } from 'next/server'

import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileActor } from '@/lib/mobile-api/auth'
import { createWorkItem, normalizeWorkItemKind, WorkItemError } from '@/lib/server/work-items'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export function OPTIONS() { return mobileOptionsResponse() }

const ALLOWED_KINDS = new Set(['task', 'follow_up', 'callback', 'send_offer'])
const ALLOWED_ASSIGNEES = new Set((process.env.CRM_MOBILE_ALLOWED_ASSIGNEES || 'Ernest,Casey').split(',').map((value) => value.trim()).filter(Boolean))

export async function POST(req: NextRequest) {
  try {
    const { actor } = await requireMobileActor(req)
    const key = req.headers.get('idempotency-key')?.trim() || ''
    if (key.length < 8 || key.length > 200) return NextResponse.json({ error: 'A stable Idempotency-Key is required' }, { status: 400, headers: mobileNoStoreHeaders() })
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 500) : ''
    const leadId = typeof body?.leadId === 'string' ? body.leadId.trim() : null
    const taskType = normalizeWorkItemKind(body?.taskType)
    const assignedTo = typeof body?.assignedTo === 'string' && body.assignedTo.trim() ? body.assignedTo.trim() : actor.name
    const department = typeof body?.department === 'string' ? body.department.trim() : 'acquisitions'
    const dueAt = typeof body?.dueDate === 'string' && !Number.isNaN(Date.parse(body.dueDate)) ? new Date(body.dueDate).toISOString() : null
    if (!title || !ALLOWED_KINDS.has(taskType) || !ALLOWED_ASSIGNEES.has(assignedTo) || department !== 'acquisitions') {
      return NextResponse.json({ error: 'Unsupported task title, type, assignee, or department' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const result = await createWorkItem({
      actor: actor.name, idempotencyKey: key, leadId, kind: taskType, title,
      notes: typeof body?.notes === 'string' ? body.notes.trim().slice(0, 5_000) || null : null,
      dueAt, assignedTo, department, role: typeof body?.role === 'string' ? body.role.trim() || null : null,
      primaryNextAction: body?.primaryNextAction === true,
      provenance: { source: 'mobile_app', actor_email: actor.email },
    })
    return NextResponse.json({ success: true, created: result.created, item: result.workItem }, { status: result.created ? 201 : 200, headers: mobileNoStoreHeaders() })
  } catch (error) {
    if (error instanceof MobileAuthError) return NextResponse.json({ error: error.message }, { status: error.status, headers: mobileNoStoreHeaders() })
    if (error instanceof WorkItemError) return NextResponse.json({ error: error.message }, { status: error.code === 'conflict' ? 409 : error.code === 'invalid' ? 400 : 503, headers: mobileNoStoreHeaders() })
    return NextResponse.json({ error: 'Work item could not be created.' }, { status: 503, headers: mobileNoStoreHeaders() })
  }
}
