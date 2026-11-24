import { NextRequest, NextResponse } from 'next/server'

import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError, requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import { MobileCommandAccessError, requireMobileCommandActor } from '@/lib/mobile-api/mobile-command-access'
import { createWorkItem, normalizeWorkItemKind, requireMobileWorkItemCreateTime, WorkItemError } from '@/lib/server/work-items'
import { parseAppointmentInstant } from '@/lib/server/appointment-instant'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export function OPTIONS() { return mobileOptionsResponse() }

const ALLOWED_KINDS = new Set(['task', 'appointment', 'follow_up', 'callback', 'send_offer'])
const ALLOWED_ASSIGNEES = new Set((process.env.CRM_MOBILE_ALLOWED_ASSIGNEES || 'Ernest,Casey').split(',').map((value) => value.trim()).filter(Boolean))

export async function POST(req: NextRequest) {
  try {
    const { actor } = await requireMobileCommandActor(req)
    const key = req.headers.get('idempotency-key')?.trim() || ''
    if (key.length < 8 || key.length > 200) return NextResponse.json({ error: 'A stable Idempotency-Key is required' }, { status: 400, headers: mobileNoStoreHeaders() })
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 500) : ''
    const leadId = typeof body?.leadId === 'string' ? body.leadId.trim() : null
    const taskType = normalizeWorkItemKind(body?.taskType)
    const assignedTo = typeof body?.assignedTo === 'string' && body.assignedTo.trim() ? body.assignedTo.trim() : actor.name
    const department = typeof body?.department === 'string' ? body.department.trim() : 'acquisitions'
    const dueAt = typeof body?.dueDate === 'string' ? parseAppointmentInstant(body.dueDate) : null
    if (body?.dueDate !== undefined && body.dueDate !== null && !dueAt) {
      return NextResponse.json({ error: 'Choose a valid task due time.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    if (!title || !ALLOWED_KINDS.has(taskType) || !ALLOWED_ASSIGNEES.has(assignedTo) || department !== 'acquisitions') {
      return NextResponse.json({ error: 'Unsupported task title, type, assignee, or department' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    if (leadId) await requireAuthorizedMobileLead(req, leadId)
    const input = {
      actor: actor.name, idempotencyKey: key, leadId, kind: taskType, title,
      notes: typeof body?.notes === 'string' ? body.notes.trim().slice(0, 5_000) || null : null,
      dueAt, assignedTo, department, role: typeof body?.role === 'string' ? body.role.trim() || null : null,
      primaryNextAction: body?.primaryNextAction === true,
      provenance: { source: 'mobile_app', actor_email: actor.email },
    }
    await requireMobileWorkItemCreateTime(input)
    const result = await createWorkItem(input)
    return NextResponse.json({ success: true, created: result.created, item: result.workItem }, { status: result.created ? 201 : 200, headers: mobileNoStoreHeaders() })
  } catch (error) {
    if (error instanceof MobileAuthError) return NextResponse.json({ error: error.message }, { status: error.status, headers: mobileNoStoreHeaders() })
    if (error instanceof MobileLeadAccessError || error instanceof MobileCommandAccessError) return NextResponse.json({ error: error.message }, { status: error.status, headers: mobileNoStoreHeaders() })
    if (error instanceof WorkItemError) return NextResponse.json({ error: error.message }, { status: error.code === 'conflict' ? 409 : error.code === 'invalid' ? 400 : 503, headers: mobileNoStoreHeaders() })
    return NextResponse.json({ error: 'Work item could not be created.' }, { status: 503, headers: mobileNoStoreHeaders() })
  }
}
