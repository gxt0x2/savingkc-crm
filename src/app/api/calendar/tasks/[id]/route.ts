export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

import { requireUserOrSecret } from '@/lib/api/admin-auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  EDITABLE_TASK_ACTIVITY_TYPES,
  isEditableTaskActivityType,
  mergeTaskActivity,
  normalizeTaskActivityPatch,
} from '@/lib/tasks/task-activity'

interface TaskActivityRow {
  id: string
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
}

async function loadTask(id: string) {
  const { data, error } = await supabaseAdmin()
    .from('lead_activities')
    .select('id, activity_type, description, agent, metadata')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as TaskActivityRow | null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = await requireUserOrSecret(req)
  if (unauthorized) return unauthorized

  const { id } = await params
  if (!id) return NextResponse.json({ success: false, error: 'Task id is required' }, { status: 400 })

  let input: unknown
  try {
    input = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const existing = await loadTask(id)
    if (!existing || !isEditableTaskActivityType(existing.activity_type)) {
      return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })
    }

    const patch = normalizeTaskActivityPatch(input)
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, error: 'No supported task changes were provided' }, { status: 400 })
    }
    if (patch.title !== undefined && !patch.title) {
      return NextResponse.json({ success: false, error: 'Task title is required' }, { status: 400 })
    }

    const update = mergeTaskActivity(existing, patch)
    const { error } = await supabaseAdmin()
      .from('lead_activities')
      .update(update)
      .eq('id', id)
      .in('activity_type', [...EDITABLE_TASK_ACTIVITY_TYPES])

    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true, taskId: id })
  } catch (error) {
    console.error('[calendar/tasks/:id] update failed:', error)
    return NextResponse.json({ success: false, error: 'Task could not be updated' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = await requireUserOrSecret(req)
  if (unauthorized) return unauthorized

  const { id } = await params
  if (!id) return NextResponse.json({ success: false, error: 'Task id is required' }, { status: 400 })

  try {
    const existing = await loadTask(id)
    if (!existing || !isEditableTaskActivityType(existing.activity_type)) {
      return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })
    }

    const { error } = await supabaseAdmin()
      .from('lead_activities')
      .delete()
      .eq('id', id)
      .in('activity_type', [...EDITABLE_TASK_ACTIVITY_TYPES])

    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true, taskId: id })
  } catch (error) {
    console.error('[calendar/tasks/:id] delete failed:', error)
    return NextResponse.json({ success: false, error: 'Task could not be deleted' }, { status: 500 })
  }
}
