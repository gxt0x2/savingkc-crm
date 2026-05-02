export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { logTcEvent } from '@/lib/tc'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    if (!body.task_type || !body.label) {
      return NextResponse.json({ error: 'task_type and label required' }, { status: 400 })
    }

    const db = supabaseAdmin()
    const { data: task, error } = await db
      .from('tc_tasks')
      .insert({
        tc_file_id: id,
        task_type: String(body.task_type),
        label: String(body.label),
        due_at: body.due_at || null,
        assigned_to: body.assigned_to || null,
        source: body.source || 'manual',
        notes: body.notes || null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await logTcEvent(db, id, 'task_created', { task_id: task.id, task_type: task.task_type }, body.actor || 'ernest')
    return NextResponse.json({ task }, { status: 201 })
  } catch (err) {
    console.error('[tc/files/:id/tasks POST] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
