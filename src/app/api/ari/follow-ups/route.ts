import { NextRequest, NextResponse } from 'next/server'
import { requireUserOrSecret } from '@/lib/api/admin-auth'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { listWorkItems, transitionWorkItem, WorkItemError } from '@/lib/server/work-items'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  try {
    // Fetch tasks due today or overdue
    const tasks = await listWorkItems({
      statuses: ['pending', 'blocked'],
      dueBefore: todayEnd.toISOString(),
      limit: 50,
    })

    if (!tasks?.length) {
      return NextResponse.json({ followUps: [], completed: 0, total: 0 })
    }

    // Fetch lead info for tasks
    const leadIds = [...new Set(tasks.flatMap(t => t.leadId ? [t.leadId] : []))]
    const leadMap = new Map<string, { full_name: string; phone: string | null; property_address: string | null; station: string | null }>()

    if (leadIds.length) {
      const { data: leads } = await supabaseAdmin()
        .from('leads')
        .select('id, full_name, phone, property_address, station')
        .in('id', leadIds)

      for (const l of leads || []) {
        leadMap.set(l.id, l)
      }
    }

    // Count completed tasks today
    const completedCount = (await listWorkItems({
      statuses: ['completed'],
      completedAfter: todayStart.toISOString(),
      limit: 500,
    })).length

    const followUps = tasks.map(t => {
      const lead = t.leadId ? leadMap.get(t.leadId) : null
      const isOverdue = !!t.dueAt && new Date(t.dueAt) < todayStart

      return {
        id: t.key,
        title: t.title,
        description: t.description || null,
        due_date: t.dueAt,
        priority: t.priority,
        status: t.status,
        is_overdue: isOverdue,
        lead_id: t.leadId,
        lead_name: lead?.full_name || null,
        lead_phone: lead?.phone || null,
        lead_address: lead?.property_address || null,
        lead_station: lead?.station || null,
      }
    })

    return NextResponse.json({
      followUps,
      completed: completedCount,
      total: completedCount + tasks.length,
    })
  } catch (err) {
    console.error('follow-ups GET error:', err)
    return NextResponse.json({ followUps: [], completed: 0, total: 0 })
  }
}

export async function PATCH(req: NextRequest) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { taskId, action } = await req.json()

    if (!taskId || !action) {
      return NextResponse.json({ error: 'Missing taskId or action' }, { status: 400 })
    }

    if (action === 'complete') {
      await transitionWorkItem({
        key: taskId,
        actor: actor.name,
        action: 'complete',
        idempotencyKey: req.headers.get('idempotency-key')?.trim() || crypto.randomUUID(),
      })
      return NextResponse.json({ success: true })
    }

    if (action === 'snooze') {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(9, 0, 0, 0)

      await transitionWorkItem({
        key: taskId,
        actor: actor.name,
        action: 'snooze',
        idempotencyKey: req.headers.get('idempotency-key')?.trim() || crypto.randomUUID(),
        patch: { dueAt: tomorrow.toISOString() },
      })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    console.error('follow-ups PATCH error:', err)
    if (err instanceof WorkItemError) {
      return NextResponse.json({ error: err.message }, { status: err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 503 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
