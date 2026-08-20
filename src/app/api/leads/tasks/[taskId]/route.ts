export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { resolveTaskAssignee } from '@/lib/api/task-assignee'
import { supabase } from '@/lib/supabase-lazy'

/**
 * PATCH /api/leads/tasks/[taskId]
 *
 * Edit / complete / dismiss a task row stored in lead_activities.
 *
 * Body shape (all optional — only sent fields are merged):
 *   {
 *     title?: string,
 *     dueDate?: string | null,           // ISO. null clears.
 *     priority?: 'critical' | 'high' | 'normal' | 'nominal',
 *     cta?: string,                      // "Start Call" | "Send SMS" | etc
 *     notes?: string,                    // detail text
 *     assignedTo?: string,
 *     status?: 'pending' | 'completed' | 'dismissed',
 *   }
 *
 * Existing metadata is preserved; only sent keys are overwritten. The endpoint
 * stamps metadata.userEdited=true and metadata.userEditedAt so the UI can
 * surface a "User-edited" pill on the Next Action card.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const authenticatedActor = await resolveAuthenticatedActor()
  if (!authenticatedActor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const actorName = authenticatedActor.name

  const { taskId } = await params
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  // Load the existing row to merge metadata.
  const { data: existing, error: loadErr } = await supabase
    .from('lead_activities')
    .select('id, activity_type, description, metadata')
    .eq('id', taskId)
    .maybeSingle()
  if (loadErr || !existing) {
    return NextResponse.json({ error: 'task not found' }, { status: 404 })
  }
  if (existing.activity_type !== 'task') {
    return NextResponse.json({ error: 'not a task row' }, { status: 400 })
  }

  const prevMeta = (existing.metadata || {}) as Record<string, unknown>
  const next = { ...prevMeta }

  if (typeof body.title === 'string') next.title = body.title.trim()
  if (typeof body.notes === 'string') next.notes = body.notes.trim()
  if (typeof body.cta === 'string') next.cta = body.cta.trim()
  const assignment = resolveTaskAssignee(body.assignedTo, actorName, {
    defaultToActor: false,
    allowUnassigned: true,
  })
  if (!assignment.authorized) {
    return NextResponse.json({ error: 'Task assignee is not authorized' }, { status: 403 })
  }
  if (assignment.assignedTo !== undefined) {
    next.assigned_to = assignment.assignedTo
  } else if (typeof next.assigned_to !== 'string' || !next.assigned_to.trim()) {
    next.assigned_to = actorName
  }
  if (typeof body.priority === 'string') {
    const p = body.priority
    if (p === 'critical' || p === 'high' || p === 'normal' || p === 'nominal') next.priority = p
  }
  if ('dueDate' in body) {
    next.due_date = body.dueDate === null
      ? null
      : (typeof body.dueDate === 'string' && body.dueDate ? new Date(body.dueDate).toISOString() : prevMeta.due_date)
  }
  if (typeof body.status === 'string') {
    const s = body.status
    if (s === 'pending' || s === 'completed' || s === 'dismissed') next.status = s
  }

  // Mark as user-edited unless this is purely a status flip (complete/dismiss
  // shouldn't masquerade as an edit; the source line stays AI if originally AI).
  const supportedMutationKeys = new Set(['title', 'notes', 'cta', 'assignedTo', 'priority', 'dueDate', 'status'])
  const mutationKeys = Object.keys(body).filter((key) => supportedMutationKeys.has(key))
  const isPureStatusFlip = mutationKeys.length === 1 && mutationKeys[0] === 'status'
  if (!isPureStatusFlip) {
    next.userEdited = true
    next.userEditedAt = new Date().toISOString()
  }
  next.updated_by = actorName

  const description = typeof next.title === 'string' && next.title ? (next.title as string) : existing.description

  const { error: updateErr } = await supabase
    .from('lead_activities')
    .update({ description, metadata: next })
    .eq('id', taskId)

  if (updateErr) {
    console.error('[next-action task PATCH] update failed:', updateErr.message)
    return NextResponse.json({ error: 'update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
