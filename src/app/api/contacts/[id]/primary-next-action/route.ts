export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { resolveTaskAssignee } from '@/lib/api/task-assignee'
import { normalizeWorkItemKind } from '@/lib/server/work-items'
import { supabaseAdmin } from '@/lib/supabase/admin'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' }

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const clean = value.trim()
  return clean ? clean.slice(0, maxLength) : null
}

function databaseResponse(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes('invalid_lead_id')) return { status: 404, error: 'Contact not found.' }
  if (normalized.includes('lead_not_active_opportunity')) return { status: 409, error: 'This contact is no longer an active opportunity.' }
  if (normalized.includes('primary_next_action_exists')) return { status: 409, error: 'A primary next action already exists. Refresh to see it.' }
  if (normalized.includes('primary_candidate_selection_required')) return { status: 409, error: 'A trustworthy existing task is available. Select it instead of creating a duplicate.' }
  if (normalized.includes('primary_candidate_not_eligible')) return { status: 409, error: 'That task is no longer eligible. Refresh and choose again.' }
  if (normalized.includes('version_conflict') || normalized.includes('idempotency_conflict')) return { status: 409, error: 'The review changed in another request. Refresh and try again.' }
  if (normalized.includes('invalid_') || normalized.includes('_required')) return { status: 400, error: 'The primary-action review is incomplete or invalid.' }
  return { status: 503, error: 'The primary-action service is unavailable.' }
}

async function leadIdFrom(params: Promise<{ id: string }>) {
  const { id } = await params
  return UUID_PATTERN.test(id) ? id : null
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }

  const leadId = await leadIdFrom(params)
  if (!leadId) {
    return NextResponse.json({ success: false, error: 'A valid contact id is required.' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
    const { data, error } = await supabaseAdmin().rpc('primary_next_action_review_v1', { p_lead_id: leadId })
    if (error) {
      console.error('[contacts/primary-next-action] review failed:', error.message)
      return NextResponse.json({ success: false, error: 'Primary-action review could not be loaded.' }, { status: 503, headers: NO_STORE_HEADERS })
    }
    const review = data as { resolutionKind?: string } | null
    if (!review || review.resolutionKind === 'not_found') {
      return NextResponse.json({ success: false, error: 'Contact not found.' }, { status: 404, headers: NO_STORE_HEADERS })
    }
    return NextResponse.json({ success: true, review }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('[contacts/primary-next-action] review unexpected error:', error)
    return NextResponse.json({ success: false, error: 'Primary-action review could not be loaded.' }, { status: 503, headers: NO_STORE_HEADERS })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }

  const leadId = await leadIdFrom(params)
  if (!leadId) {
    return NextResponse.json({ success: false, error: 'A valid contact id is required.' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const action = body?.action === 'select_existing' || body?.action === 'create' ? body.action : null
  if (!action) {
    return NextResponse.json({ success: false, error: 'Choose an existing task or create a reviewed task.' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const idempotencyKey = text(request.headers.get('idempotency-key'), 200)
    || text(body?.idempotencyKey, 200)
    || crypto.randomUUID()
  const workItemKey = text(body?.workItemKey, 200)
  const expectedVersion = typeof body?.expectedVersion === 'number' && Number.isInteger(body.expectedVersion)
    ? body.expectedVersion
    : null

  let dueAt: string | null = null
  let assignedTo: string | null = null
  if (action === 'select_existing') {
    if (!workItemKey || expectedVersion === null) {
      return NextResponse.json({ success: false, error: 'Choose a current task from this review.' }, { status: 400, headers: NO_STORE_HEADERS })
    }
  } else {
    const title = text(body?.title, 240)
    const dueDate = typeof body?.dueAt === 'string' ? new Date(body.dueAt) : null
    const assignment = resolveTaskAssignee(body?.assignedTo, actor.name, { defaultToActor: true })
    if (!title) {
      return NextResponse.json({ success: false, error: 'Task title is required.' }, { status: 400, headers: NO_STORE_HEADERS })
    }
    if (!dueDate || Number.isNaN(dueDate.getTime())) {
      return NextResponse.json({ success: false, error: 'A valid due date is required.' }, { status: 400, headers: NO_STORE_HEADERS })
    }
    if (!assignment.authorized || !assignment.assignedTo) {
      return NextResponse.json({ success: false, error: 'Task assignee is not authorized.' }, { status: 403, headers: NO_STORE_HEADERS })
    }
    dueAt = dueDate.toISOString()
    assignedTo = assignment.assignedTo
  }

  try {
    const { data, error } = await supabaseAdmin().rpc('resolve_primary_next_action_v1', {
      p_lead_id: leadId,
      p_action: action,
      p_actor: actor.name,
      p_idempotency_key: idempotencyKey,
      p_work_item_key: workItemKey,
      p_expected_version: expectedVersion,
      p_kind: action === 'create' ? normalizeWorkItemKind(body?.kind) : null,
      p_title: action === 'create' ? text(body?.title, 240) : null,
      p_notes: action === 'create' ? text(body?.notes, 2_000) : null,
      p_due_at: dueAt,
      p_assigned_to: assignedTo,
    })
    if (error) {
      const response = databaseResponse(error.message)
      console.error('[contacts/primary-next-action] resolution failed:', error.message)
      return NextResponse.json({ success: false, error: response.error }, { status: response.status, headers: NO_STORE_HEADERS })
    }
    const result = data as { changed?: boolean; resolution?: string; review?: unknown } | null
    if (!result?.review) {
      return NextResponse.json({ success: false, error: 'The primary-action result was incomplete.' }, { status: 503, headers: NO_STORE_HEADERS })
    }
    return NextResponse.json({ success: true, changed: result.changed === true, resolution: result.resolution, review: result.review }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('[contacts/primary-next-action] resolution unexpected error:', error)
    return NextResponse.json({ success: false, error: 'The primary-action service is unavailable.' }, { status: 503, headers: NO_STORE_HEADERS })
  }
}
