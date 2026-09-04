import 'server-only'

import { isCurrentUserAdmin } from '@/lib/auth/admin'
import {
  buildMyDay,
  resolveMyDayDateRange,
  type MyDayActivity,
  type MyDayAgentStat,
  type MyDayAppointment,
  type MyDayData,
  type MyDayGoalSet,
  type MyDayLead,
  type MyDayNativeDialerPerformanceRow,
  type MyDayPerformanceRow,
  type MyDayRangeRequest,
  type MyDaySourceFreshness,
} from '@/lib/my-day'
import { getMojoHealth } from '@/lib/marketing/mojo-health'
import {
  buildMojoAttentionItems,
  type MyDayAttentionLead,
  type MyDayMojoEvent,
  type MyDayTerminalEvent,
} from '@/lib/my-day-attention'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isCaseyCrmUser } from '@/lib/telephony/agent-identity'
import { CASEY_CRM_EMAIL } from '@/lib/telephony/agent-identity'
import { loadDialerDailyPerformance } from '@/lib/server/dialer-daily-performance'

const TASK_ACTIVITY_TYPES = ['task', 'appointment', 'follow_up', 'callback', 'send_offer'] as const
const FUNNEL_ACTIVITY_TYPES = ['status_change', 'outcome', 'appointment', 'offer'] as const

/**
 * Casey is the only agent who receives My Day in navigation. SavingKC admins
 * may open the direct URL to review her workspace without exposing the tab to
 * the rest of the team.
 */
export async function canAccessCaseyMyDay(email: string | null | undefined): Promise<boolean> {
  if (!email) return false
  if (isCaseyCrmUser(email)) return true
  return isCurrentUserAdmin()
}

function configuredNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function dedupeActivities(rows: MyDayActivity[]) {
  return [...new Map(rows.map((row) => [row.id, row])).values()]
}

function shiftDateKey(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export async function loadCaseyMyDay(rangeRequest: MyDayRangeRequest = {}, now = new Date()): Promise<MyDayData> {
  const range = resolveMyDayDateRange(rangeRequest, now)
  const month = range.to.slice(0, 7)
  const db = supabaseAdmin()
  // Include a one-week collar so the daily workweek breakdown remains complete
  // even when the selected range is a single day or crosses a month boundary.
  const queryStart = shiftDateKey(range.from, -7)
  const queryEnd = shiftDateKey(range.to, 7)
  const activityStart = new Date(`${queryStart}T00:00:00Z`)
  activityStart.setUTCDate(activityStart.getUTCDate() - 1)
  const activityEnd = new Date(`${queryEnd}T23:59:59.999Z`)
  activityEnd.setUTCDate(activityEnd.getUTCDate() + 1)
  const commitmentEnd = new Date(now.getTime() + 14 * 86_400_000).toISOString()

  const [statsResult, performanceResult, leadsResult, rolesResult, dialerPerformanceResult, mojoEventsResult, mojoHealth] = await Promise.all([
    db
      .from('agent_daily_stats')
      .select('date, calls_made, meaningful_conversations, followups_completed, followups_missed, metadata')
      .eq('agent_id', 'casey')
      .gte('date', queryStart)
      .lte('date', queryEnd)
      .order('date', { ascending: true }),
    db
      .from('mojo_agent_daily_performance')
      .select('metric_date, dialing_seconds, in_progress_seconds, calls, contacts, leads, appointments, source_fetched_at')
      .eq('agent_key', 'casey')
      .gte('metric_date', queryStart)
      .lte('metric_date', queryEnd)
      .order('metric_date', { ascending: true }),
    db
      .from('leads')
      .select('id, full_name, phone, property_address, city, source, station, priority, assigned_agent, created_at, updated_at')
      .ilike('assigned_agent', '%casey%')
      .neq('classification', 'dead')
      .order('updated_at', { ascending: false })
      .limit(5000),
    db.from('roles').select('name, kpi_targets').eq('name', 'Acquisition Agent').maybeSingle(),
    loadDialerDailyPerformance({
      actorEmail: CASEY_CRM_EMAIL,
      agentName: 'Casey',
      from: queryStart,
      to: queryEnd,
      now,
      includeLeads: false,
    }).then((data) => ({ data, error: null as Error | null })).catch((error: unknown) => ({
      data: null,
      error: error instanceof Error ? error : new Error('Native dialer performance unavailable'),
    })),
    db
      .from('crm_mojo_call_events')
      .select('record_id, lead_id, contact_name, property_address, call_at, disposition_raw, outcome, follow_up_at')
      .eq('agent_key', 'casey')
      .gte('call_at', activityStart.toISOString())
      .lte('call_at', activityEnd.toISOString())
      .order('call_at', { ascending: true })
      .limit(1000),
    getMojoHealth(db, { now }),
  ])

  if (leadsResult.error) throw new Error(`Casey's pipeline could not load: ${leadsResult.error.message}`)
  const leads = (leadsResult.data ?? []) as MyDayLead[]
  const leadIds = leads.map((lead) => lead.id)
  const mojoEvents = mojoEventsResult.error ? [] : (mojoEventsResult.data ?? []) as MyDayMojoEvent[]
  const attentionLeadIds = [...new Set(mojoEvents.map((event) => event.lead_id).filter((id): id is string => Boolean(id)))]
  const mojoRecordIds = [...new Set(mojoEvents.map((event) => event.record_id))]

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

  const attentionLeadsQuery = attentionLeadIds.length > 0
    ? db
      .from('leads')
      .select('id, full_name, property_address, station, classification')
      .in('id', attentionLeadIds)
      .limit(1000)
    : Promise.resolve({ data: [], error: null })
  const terminalEventsQuery = attentionLeadIds.length > 0
    ? db
      .from('crm_lifecycle_events')
      .select('lead_id, to_stage, occurred_at')
      .in('lead_id', attentionLeadIds)
      .in('to_stage', ['dead', 'closed_lost'])
      .lte('occurred_at', activityEnd.toISOString())
      .order('occurred_at', { ascending: true })
      .limit(1000)
    : Promise.resolve({ data: [], error: null })
  const reviewedMojoEventsQuery = mojoRecordIds.length > 0
    ? db
      .from('lead_activities')
      .select('metadata')
      .eq('activity_type', 'mojo_review')
      .in('metadata->>record_id', mojoRecordIds)
      .limit(1000)
    : Promise.resolve({ data: [], error: null })

  const [activityResult, caseyFunnelActivityResult, agentTasksResult, assignedTasksResult, appointmentsResult, attentionLeadsResult, terminalEventsResult, reviewedMojoEventsResult] = await Promise.all([
    activityQuery,
    db
      .from('lead_activities')
      .select('id, lead_id, activity_type, description, agent, metadata, created_at')
      .in('activity_type', [...FUNNEL_ACTIVITY_TYPES])
      .ilike('agent', '%casey%')
      .gte('created_at', activityStart.toISOString())
      .lte('created_at', activityEnd.toISOString())
      .order('created_at', { ascending: true })
      .limit(10000),
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
      .gte('scheduled_at', now.toISOString())
      .lte('scheduled_at', commitmentEnd)
      .order('scheduled_at', { ascending: true })
      .limit(1000),
    attentionLeadsQuery,
    terminalEventsQuery,
    reviewedMojoEventsQuery,
  ])

  if (activityResult.error) throw new Error(`Casey's activity history could not load: ${activityResult.error.message}`)
  if (caseyFunnelActivityResult.error) throw new Error(`Casey's funnel history could not load: ${caseyFunnelActivityResult.error.message}`)
  const taskErrors = [agentTasksResult.error, assignedTasksResult.error].filter(Boolean)
  if (taskErrors.length === 2) throw new Error(`Casey's task queue could not load: ${taskErrors[0]?.message}`)

  const targets = rolesResult.data?.kpi_targets as Record<string, unknown> | null | undefined
  const goals: MyDayGoalSet = {
    dailyCalls: configuredNumber(targets?.daily_call_volume),
    weeklyOpportunities: configuredNumber(targets?.leads_qualified_per_week),
    weeklyAppointments: configuredNumber(targets?.appointments_set_per_week),
  }
  const attentionAvailable = !mojoEventsResult.error && !attentionLeadsResult.error && !terminalEventsResult.error && !reviewedMojoEventsResult.error
  const reviewedRecordIds = (reviewedMojoEventsResult.data ?? []).flatMap((row) => {
    const metadata = row.metadata as Record<string, unknown> | null
    return typeof metadata?.record_id === 'string' ? [metadata.record_id] : []
  })
  const attentionItems = attentionAvailable
    ? buildMojoAttentionItems({
      events: mojoEvents,
      leads: (attentionLeadsResult.data ?? []) as MyDayAttentionLead[],
      terminalEvents: (terminalEventsResult.data ?? []) as MyDayTerminalEvent[],
      reviewedRecordIds,
      range,
    })
    : []
  const sourceFreshness: MyDaySourceFreshness = mojoHealth.status === 'clean'
    ? {
        status: 'current',
        message: mojoHealth.message,
        lastSuccessfulSyncAt: mojoHealth.performance.latestFetchedAt ?? mojoHealth.lastSyncAt,
        ageMinutes: mojoHealth.performance.ageMinutes ?? mojoHealth.lastSyncAgeMinutes,
      }
    : mojoHealth.status === 'watch'
      ? {
          status: 'delayed',
          message: mojoHealth.message,
          lastSuccessfulSyncAt: mojoHealth.performance.latestFetchedAt ?? mojoHealth.lastSyncAt,
          ageMinutes: mojoHealth.performance.ageMinutes ?? mojoHealth.lastSyncAgeMinutes,
        }
      : {
          status: mojoHealth.lastSyncAt ? 'stale' : 'unavailable',
          message: mojoHealth.message,
          lastSuccessfulSyncAt: mojoHealth.performance.latestFetchedAt ?? mojoHealth.lastSyncAt,
          ageMinutes: mojoHealth.performance.ageMinutes ?? mojoHealth.lastSyncAgeMinutes,
        }

  return buildMyDay({
    month,
    range,
    now,
    stats: statsResult.error ? [] : (statsResult.data ?? []) as MyDayAgentStat[],
    performance: performanceResult.error ? [] : (performanceResult.data ?? []) as MyDayPerformanceRow[],
    sourceFreshness,
    dialerPerformance: (dialerPerformanceResult.data?.rows ?? []) as MyDayNativeDialerPerformanceRow[],
    leads,
    activities: dedupeActivities([
      ...((activityResult.data ?? []) as MyDayActivity[]),
      ...((caseyFunnelActivityResult.data ?? []) as MyDayActivity[]),
    ]),
    tasks: dedupeActivities([
      ...((agentTasksResult.data ?? []) as MyDayActivity[]),
      ...((assignedTasksResult.data ?? []) as MyDayActivity[]),
    ]),
    appointments: appointmentsResult.error ? [] : (appointmentsResult.data ?? []) as MyDayAppointment[],
    attentionItems,
    attentionAvailable,
    goals,
    availability: {
      mojoPerformance: !performanceResult.error,
      dialerPerformance: !dialerPerformanceResult.error,
      agentStats: !statsResult.error,
      appointments: !appointmentsResult.error,
      habits: false,
    },
  })
}
