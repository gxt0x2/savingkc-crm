import 'server-only'

import { buildMyDay, normalizeMyDayMonth, type MyDayActivity, type MyDayAgentStat, type MyDayAppointment, type MyDayData, type MyDayGoalSet, type MyDayLead } from '@/lib/my-day'
import { supabaseAdmin } from '@/lib/supabase/admin'

const TASK_ACTIVITY_TYPES = ['task', 'appointment', 'follow_up', 'callback', 'send_offer'] as const

function configuredNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function dedupeActivities(rows: MyDayActivity[]) {
  return [...new Map(rows.map((row) => [row.id, row])).values()]
}

export async function loadCaseyMyDay(monthValue?: string | null, now = new Date()): Promise<MyDayData> {
  const month = normalizeMyDayMonth(monthValue, now)
  const db = supabaseAdmin()
  const monthStart = `${month}-01`
  const [year, monthNumber] = month.split('-').map(Number)
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0, 23, 59, 59, 999)).toISOString()
  const activityStart = new Date(`${monthStart}T00:00:00Z`)
  activityStart.setUTCDate(activityStart.getUTCDate() - 1)
  const activityEnd = new Date(monthEnd)
  activityEnd.setUTCDate(activityEnd.getUTCDate() + 1)
  const commitmentEnd = new Date(now.getTime() + 14 * 86_400_000).toISOString()

  const [statsResult, leadsResult, rolesResult] = await Promise.all([
    db
      .from('agent_daily_stats')
      .select('date, calls_made, meaningful_conversations, followups_completed, followups_missed, metadata')
      .eq('agent_id', 'casey')
      .gte('date', monthStart)
      .lte('date', monthEnd.slice(0, 10))
      .order('date', { ascending: true }),
    db
      .from('leads')
      .select('id, full_name, phone, property_address, city, source, station, priority, assigned_agent, created_at, updated_at')
      .ilike('assigned_agent', '%casey%')
      .neq('classification', 'dead')
      .order('updated_at', { ascending: false })
      .limit(5000),
    db.from('roles').select('name, kpi_targets').eq('name', 'Acquisition Agent').maybeSingle(),
  ])

  if (leadsResult.error) throw new Error(`Casey's pipeline could not load: ${leadsResult.error.message}`)
  const leads = (leadsResult.data ?? []) as MyDayLead[]
  const leadIds = leads.map((lead) => lead.id)

  const activityQuery = leadIds.length > 0
    ? db
      .from('lead_activities')
      .select('id, lead_id, activity_type, description, agent, metadata, created_at')
      .in('lead_id', leadIds)
      .gte('created_at', activityStart.toISOString())
      .lte('created_at', activityEnd.toISOString())
      .order('created_at', { ascending: true })
      .limit(10000)
    : Promise.resolve({ data: [], error: null })

  const [activityResult, agentTasksResult, assignedTasksResult, appointmentsResult] = await Promise.all([
    activityQuery,
    db
      .from('lead_activities')
      .select('id, lead_id, activity_type, description, agent, metadata, created_at')
      .in('activity_type', [...TASK_ACTIVITY_TYPES])
      .ilike('agent', '%casey%')
      .order('created_at', { ascending: false })
      .limit(1000),
    db
      .from('lead_activities')
      .select('id, lead_id, activity_type, description, agent, metadata, created_at')
      .in('activity_type', [...TASK_ACTIVITY_TYPES])
      .ilike('metadata->>assigned_to', '%casey%')
      .order('created_at', { ascending: false })
      .limit(1000),
    db
      .from('appointments')
      .select('id, lead_id, type, status, scheduled_at, assigned_to, address, notes, created_at')
      .ilike('assigned_to', '%casey%')
      .gte('scheduled_at', activityStart.toISOString())
      .lte('scheduled_at', commitmentEnd)
      .order('scheduled_at', { ascending: true })
      .limit(1000),
  ])

  if (activityResult.error) throw new Error(`Casey's activity history could not load: ${activityResult.error.message}`)
  const taskErrors = [agentTasksResult.error, assignedTasksResult.error].filter(Boolean)
  if (taskErrors.length === 2) throw new Error(`Casey's task queue could not load: ${taskErrors[0]?.message}`)

  const targets = rolesResult.data?.kpi_targets as Record<string, unknown> | null | undefined
  const goals: MyDayGoalSet = {
    dailyCalls: configuredNumber(targets?.daily_call_volume),
    weeklyOpportunities: configuredNumber(targets?.leads_qualified_per_week),
    weeklyAppointments: configuredNumber(targets?.appointments_set_per_week),
  }

  return buildMyDay({
    month,
    now,
    stats: statsResult.error ? [] : (statsResult.data ?? []) as MyDayAgentStat[],
    leads,
    activities: (activityResult.data ?? []) as MyDayActivity[],
    tasks: dedupeActivities([
      ...((agentTasksResult.data ?? []) as MyDayActivity[]),
      ...((assignedTasksResult.data ?? []) as MyDayActivity[]),
    ]),
    appointments: appointmentsResult.error ? [] : (appointmentsResult.data ?? []) as MyDayAppointment[],
    goals,
    availability: {
      agentStats: !statsResult.error,
      appointments: !appointmentsResult.error,
      habits: false,
    },
  })
}
