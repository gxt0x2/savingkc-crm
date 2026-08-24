import { NextRequest, NextResponse } from 'next/server'
import { resolveTaskAssignee } from '@/lib/api/task-assignee'
import {
  MobileAuthError,
  mobileNoStoreHeaders,
  mobileOptionsResponse,
  requireMobileActor,
} from '@/lib/mobile-api/auth'
import { applyCrmLifecycleCommand, CrmLifecycleError } from '@/lib/server/crm-lifecycle'

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
      return NextResponse.json({ error: 'Contact id is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const body = await req.json().catch(() => null) as { owner?: unknown } | null
    if (!body || !Object.prototype.hasOwnProperty.call(body, 'owner')) {
      return NextResponse.json({ error: 'Choose an owner or Unassigned.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const assignment = resolveTaskAssignee(body.owner, actor.name, { defaultToActor: false, allowUnassigned: true })
    if (!assignment.authorized || assignment.assignedTo === undefined) {
      return NextResponse.json({ error: 'Owner is not authorized.' }, { status: 403, headers: mobileNoStoreHeaders() })
    }

    const result = await applyCrmLifecycleCommand({
      leadId: id,
      commandId: req.headers.get('idempotency-key')?.trim() || crypto.randomUUID(),
      commandType: 'assign',
      stage: null,
      owner: assignment.assignedTo,
      deadReason: null,
      deadReasonNotes: null,
      reason: `Mobile assignment by ${actor.name}`,
      evidenceType: null,
      evidenceReference: null,
      actorEmail: actor.email,
      actorName: actor.name,
    })
    return NextResponse.json({ success: true, owner: result.owner }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    if (error instanceof MobileAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: mobileNoStoreHeaders() })
    }
    if (error instanceof CrmLifecycleError) {
      const status = error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : error.code === 'invalid' ? 400 : 503
      return NextResponse.json({ error: error.message }, { status, headers: mobileNoStoreHeaders() })
    }
    console.error('[mobile/leads/:id/owner] assignment failed', error)
    return NextResponse.json({ error: 'Owner could not be updated.' }, { status: 503, headers: mobileNoStoreHeaders() })
  }
}
