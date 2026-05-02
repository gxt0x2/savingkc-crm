export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { logTcEvent } from '@/lib/tc'

const VALID_TASK_STATUSES = ['open', 'done', 'waived', 'blocked']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const updates: Record<string, unknown> = {}

    for (const field of ['label', 'status', 'due_at', 'completed_at', 'assigned_to', 'notes'] as const) {
      if (field in body) updates[field] = body[field]
    }
    if (typeof updates.status === 'string' && !VALID_TASK_STATUSES.includes(updates.status)) {
      return NextResponse.json({ error: 'Invalid task status' }, { status: 400 })
    }
    if (updates.status === 'done' && !updates.completed_at) updates.completed_at = new Date().toISOString()
    if (updates.status === 'open') updates.completed_at = null

    const db = supabaseAdmin()
    const { data: task, error } = await db
      .from('tc_tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error || !task) return NextResponse.json({ error: error?.message || 'Task not found' }, { status: 404 })
    await logTcEvent(db, task.tc_file_id, 'task_updated', { task_id: id, updates }, body.actor || 'ernest')
    return NextResponse.json({ task })
  } catch (err) {
    console.error('[tc/tasks/:id PATCH] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
