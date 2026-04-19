import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

export async function GET() {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  try {
    // Fetch tasks due today or overdue
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, due_date, priority, status, lead_id, description')
      .in('status', ['pending', 'overdue'])
      .lte('due_date', todayEnd.toISOString())
      .order('due_date', { ascending: true })
      .limit(50)

    if (!tasks?.length) {
      return NextResponse.json({ followUps: [], completed: 0, total: 0 })
    }

    // Fetch lead info for tasks
    const leadIds = [...new Set(tasks.filter(t => t.lead_id).map(t => t.lead_id!))]
    let leadMap = new Map<string, { full_name: string; phone: string | null; property_address: string | null; station: string | null }>()

    if (leadIds.length) {
      const { data: leads } = await supabase
        .from('leads')
        .select('id, full_name, phone, property_address, station')
        .in('id', leadIds)

      for (const l of leads || []) {
        leadMap.set(l.id, l)
      }
    }

    // Count completed tasks today
    const { count: completedCount } = await supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed')
      .gte('due_date', todayStart.toISOString())
      .lte('due_date', todayEnd.toISOString())

    const followUps = tasks.map(t => {
      const lead = t.lead_id ? leadMap.get(t.lead_id) : null
      const isOverdue = new Date(t.due_date) < todayStart

      return {
        id: t.id,
        title: t.title,
        description: t.description || null,
        due_date: t.due_date,
        priority: t.priority,
        status: t.status,
        is_overdue: isOverdue,
        lead_id: t.lead_id,
        lead_name: lead?.full_name || null,
        lead_phone: lead?.phone || null,
        lead_address: lead?.property_address || null,
        lead_station: lead?.station || null,
      }
    })

    return NextResponse.json({
      followUps,
      completed: completedCount || 0,
      total: (completedCount || 0) + tasks.length,
    })
  } catch (err) {
    console.error('follow-ups GET error:', err)
    return NextResponse.json({ followUps: [], completed: 0, total: 0 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { taskId, action } = await req.json()

    if (!taskId || !action) {
      return NextResponse.json({ error: 'Missing taskId or action' }, { status: 400 })
    }

    if (action === 'complete') {
      const { error } = await supabase
        .from('tasks')
        .update({ status: 'completed' })
        .eq('id', taskId)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    if (action === 'snooze') {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(9, 0, 0, 0)

      const { error } = await supabase
        .from('tasks')
        .update({ due_date: tomorrow.toISOString(), status: 'pending' })
        .eq('id', taskId)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    console.error('follow-ups PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
