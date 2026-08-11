export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

import { requireUserOrSecret } from '@/lib/api/admin-auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  EDITABLE_TASK_ACTIVITY_TYPES,
  mergeTaskActivity,
  type EditableTaskStatus,
} from '@/lib/tasks/task-activity'

interface TaskActivityRow {
  id: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
}

type BulkTaskAction = 'complete' | 'reopen' | 'assign' | 'delete'

export async function POST(req: NextRequest) {
  const unauthorized = await requireUserOrSecret(req)
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const ids = Array.from(new Set(
    Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [],
  )).slice(0, 200)
  const action = body.action as BulkTaskAction

  if (ids.length === 0) {
    return NextResponse.json({ success: false, error: 'Select at least one task' }, { status: 400 })
  }
  if (!['complete', 'reopen', 'assign', 'delete'].includes(action)) {
    return NextResponse.json({ success: false, error: 'Unsupported bulk task action' }, { status: 400 })
  }

  const db = supabaseAdmin()

  try {
    if (action === 'delete') {
      const { data, error } = await db
        .from('lead_activities')
        .delete()
        .in('id', ids)
        .in('activity_type', [...EDITABLE_TASK_ACTIVITY_TYPES])
        .select('id')

      if (error) throw new Error(error.message)
      return NextResponse.json({ success: true, changed: data?.length || 0 })
    }

    const assignedTo = body.assignedTo === null
      ? null
      : typeof body.assignedTo === 'string'
        ? body.assignedTo.trim() || null
        : undefined
    if (action === 'assign' && assignedTo === undefined) {
      return NextResponse.json({ success: false, error: 'Choose an assignee' }, { status: 400 })
    }

    const { data, error: loadError } = await db
      .from('lead_activities')
      .select('id, description, agent, metadata')
      .in('id', ids)
      .in('activity_type', [...EDITABLE_TASK_ACTIVITY_TYPES])

    if (loadError) throw new Error(loadError.message)
    const rows = (data || []) as TaskActivityRow[]
    const status: EditableTaskStatus | undefined = action === 'complete'
      ? 'completed'
      : action === 'reopen'
        ? 'pending'
        : undefined
    const changedAt = new Date().toISOString()

    const results = await Promise.all(rows.map(async (row) => {
      const update = mergeTaskActivity(row, {
        status,
        assignedTo: action === 'assign' ? assignedTo : undefined,
      }, changedAt)
      const { error } = await db.from('lead_activities').update(update).eq('id', row.id)
      return error ? { id: row.id, error: error.message } : { id: row.id, error: null }
    }))

    const failed = results.filter((result) => result.error)
    if (failed.length > 0) {
      console.error('[calendar/tasks/bulk] partial update failed:', failed)
      return NextResponse.json({ success: false, error: 'Some tasks could not be changed', changed: results.length - failed.length }, { status: 500 })
    }

    return NextResponse.json({ success: true, changed: results.length })
  } catch (error) {
    console.error('[calendar/tasks/bulk] request failed:', error)
    return NextResponse.json({ success: false, error: 'Bulk task change failed' }, { status: 500 })
  }
}
