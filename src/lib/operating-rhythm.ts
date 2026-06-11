/**
 * ARI CRM - Operating Rhythm Engine
 * Night 3: RHY-01, RHY-02, RHY-03
 *
 * Morning briefing, EOD reconciliation, and weekly review data assembly
 */

import { createClient } from '@supabase/supabase-js'
import type { AgentDailyStats } from './agent-stats'
import { getTodayStats, getStatsRange, aggregateStats } from './agent-stats'
import { getMissingPillars } from './pillar-warnings'

// ============================================================================
// RHY-01: MORNING BRIEFING DATA
// ============================================================================

export interface MorningBriefingData {
  date: string
  system_alerts: SystemAlert[]
  callbacks_today: CallbackItem[]
  overdue_followups: FollowUpItem[]
  leads_needing_attention: LeadAttentionItem[]
  mail_arriving_today: MailItem[]
  pipeline_summary: PipelineSummary
  yesterday_stats: AgentDailyStats | null
}

interface SystemAlert {
  system: string
  priority: 'critical' | 'high' | 'medium'
  title: string
  description: string
  updated_at: string | null
}

interface CallbackItem {
  lead_id: string
  lead_name: string | null
  property_address: string | null
  scheduled_time: string
  task_description: string
  missing_pillars?: string[]
}

interface FollowUpItem {
  lead_id: string
  lead_name: string | null
  task_description: string
  due_date: string
  days_overdue: number
}

interface LeadAttentionItem {
  lead_id: string
  lead_name: string | null
  property_address: string | null
  reason: string
  priority: 'critical' | 'high' | 'medium'
}

interface MailItem {
  lead_id: string
  lead_name: string | null
  estimated_delivery: string
  days_in_transit: number
}

interface PipelineSummary {
  new: number
  contacted: number
  qualified: number
  offer_made: number
  under_contract: number
  disposition: number
  closed: number
  total: number
}

function configValue(row: { value?: unknown } | undefined): string {
  const value = row?.value
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

async function getMojoSessionSystemAlert(supabase: any): Promise<SystemAlert | null> {
  const { data } = await supabase
    .from('system_config')
    .select('key, value, updated_at')
    .in('key', [
      'mojo_session_status',
      'mojo_session_last_error',
      'mojo_session_last_error_at',
      'mojo_sync_health',
    ])

  const byKey = new Map((data || []).map((row: any) => [row.key, row]))
  const status = configValue(byKey.get('mojo_session_status')).toLowerCase()
  const syncHealth = configValue(byKey.get('mojo_sync_health')).toLowerCase()

  if (status !== 'expired' && syncHealth !== 'down') return null

  const lastError = configValue(byKey.get('mojo_session_last_error'))
  return {
    system: 'mojo_session',
    priority: 'critical',
    title: 'Mojo session expired',
    description: lastError || 'Mojo session expired - manual refresh required. Casey calls are not syncing to CRM.',
    updated_at:
      configValue(byKey.get('mojo_session_last_error_at')) ||
      byKey.get('mojo_session_status')?.updated_at ||
      null,
  }
}

/**
 * Assemble morning briefing data
 * Call this at office hours start (or on-demand)
 */
export async function getMorningBriefing(
  agentId: string = 'casey'
): Promise<MorningBriefingData> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

  // Today's scheduled callbacks
  const { data: callbackTasks } = await supabase
    .from('lead_activities')
    .select('*, leads(*)')
    .eq('type', 'callback')
    .eq('metadata->status', 'pending')
    .gte('metadata->due_date', today)
    .lt('metadata->due_date', `${today}T23:59:59`)
    .order('metadata->due_date', { ascending: true })

  // Fetch missing pillars for each callback - CIM-03
  const callbacks: CallbackItem[] = []
  if (callbackTasks) {
    for (const task of callbackTasks as any[]) {
      const missingPillars = await getMissingPillars(task.lead_id)
      callbacks.push({
        lead_id: task.lead_id,
        lead_name: task.leads?.full_name,
        property_address: task.leads?.property_address,
        scheduled_time: task.metadata?.due_date || 'Not scheduled',
        task_description: task.description || 'Callback',
        missing_pillars: missingPillars,
      })
    }
  }

  // Overdue follow-ups
  const { data: overdueTasks } = await supabase
    .from('lead_activities')
    .select('*, leads(*)')
    .in('type', ['task', 'follow_up', 'callback'])
    .eq('metadata->status', 'pending')
    .lt('metadata->due_date', today)
    .order('metadata->due_date', { ascending: true })
    .limit(20)

  const overdueFollowups: FollowUpItem[] =
    overdueTasks?.map((task: any) => {
      const dueDate = new Date(task.metadata?.due_date || today)
      const now = new Date()
      const daysOverdue = Math.floor(
        (now.getTime() - dueDate.getTime()) / 86400000
      )

      return {
        lead_id: task.lead_id,
        lead_name: task.leads?.full_name,
        task_description: task.description || 'Follow-up',
        due_date: task.metadata?.due_date || '',
        days_overdue: daysOverdue,
      }
    }) || []

  // Leads requiring attention (from stage timeouts, temperature changes)
  const { data: attentionLeads } = await supabase
    .from('ari_briefing_events')
    .select('lead_id, title, description, priority')
    .in('event_type', ['stage_timeout', 'temperature_change', 'follow_up_overdue'])
    .eq('dismissed', false)
    .gte('created_at', yesterday)
    .order('priority', { ascending: true })
    .limit(10)

  const leadsNeedingAttention: LeadAttentionItem[] =
    attentionLeads?.map((event: any) => ({
      lead_id: event.lead_id,
      lead_name: event.title.split(':')[1]?.trim() || 'Unknown',
      property_address: null,
      reason: event.description,
      priority: event.priority,
    })) || []

  // Mail arriving today (from letter tracking)
  const { data: mailInTransit } = await supabase
    .from('lead_activities')
    .select('*, leads(*)')
    .eq('type', 'letter_tracking')
    .eq('metadata->stage', 'in_transit')

  const mailToday: MailItem[] =
    mailInTransit
      ?.filter((mail: any) => {
        // Estimate 3-5 day delivery from mailed date
        const mailedDate = new Date(mail.metadata?.mailed_date || '1970-01-01')
        const daysInTransit = Math.floor(
          (Date.now() - mailedDate.getTime()) / 86400000
        )
        return daysInTransit >= 3 && daysInTransit <= 5
      })
      .map((mail: any) => ({
        lead_id: mail.lead_id,
        lead_name: mail.leads?.full_name,
        estimated_delivery: today,
        days_in_transit: Math.floor(
          (Date.now() - new Date(mail.metadata?.mailed_date).getTime()) /
            86400000
        ),
      })) || []

  // Pipeline summary
  const { data: pipelineData } = await supabase
    .from('leads')
    .select('station')
    .not('station', 'eq', 'dead')

  const pipelineSummary: PipelineSummary = {
    new: 0,
    contacted: 0,
    qualified: 0,
    offer_made: 0,
    under_contract: 0,
    disposition: 0,
    closed: 0,
    total: pipelineData?.length || 0,
  }

  pipelineData?.forEach((lead: any) => {
    const stage = lead.station as keyof Omit<PipelineSummary, 'total'>
    if (stage && stage in pipelineSummary) {
      pipelineSummary[stage]++
    }
  })

  // Yesterday's stats
  const yesterdayStats = await getTodayStats(agentId)
  const mojoSessionAlert = await getMojoSessionSystemAlert(supabase)

  return {
    date: today,
    system_alerts: mojoSessionAlert ? [mojoSessionAlert] : [],
    callbacks_today: callbacks,
    overdue_followups: overdueFollowups,
    leads_needing_attention: leadsNeedingAttention,
    mail_arriving_today: mailToday,
    pipeline_summary: pipelineSummary,
    yesterday_stats: yesterdayStats,
  }
}

// ============================================================================
// RHY-02: EOD RECONCILIATION DATA
// ============================================================================

export interface EODReconciliationData {
  date: string
  tasks_due_today: {
    total: number
    completed: number
    missed: number
    completion_rate: number
  }
  followup_sequences: {
    should_have_advanced: number
    actually_advanced: number
    gap: number
  }
  disposition_gap: {
    calls_made: number
    dispositions_logged: number
    gap: number
  }
  scheduled_contacts: {
    planned: number
    contacted: number
    gap: number
  }
}

/**
 * Assemble EOD reconciliation data
 * Compare planned vs accomplished
 */
export async function getEODReconciliation(
  agentId: string = 'casey'
): Promise<EODReconciliationData> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const today = new Date().toISOString().split('T')[0]

  // Tasks due today
  const { data: dueTasks } = await supabase
    .from('lead_activities')
    .select('metadata')
    .in('type', ['task', 'callback', 'follow_up'])
    .gte('metadata->due_date', today)
    .lt('metadata->due_date', `${today}T23:59:59`)

  const totalTasksToday = dueTasks?.length || 0
  const completedTasks =
    dueTasks?.filter((t: any) => t.metadata?.status === 'completed').length || 0
  const missedTasks = totalTasksToday - completedTasks

  // Get today's stats for calls vs dispositions
  const stats = await getTodayStats(agentId)

  const dispositionGap = stats
    ? {
        calls_made: stats.calls_made,
        dispositions_logged: stats.dispositions_logged,
        gap: stats.calls_made - stats.dispositions_logged,
      }
    : { calls_made: 0, dispositions_logged: 0, gap: 0 }

  return {
    date: today,
    tasks_due_today: {
      total: totalTasksToday,
      completed: completedTasks,
      missed: missedTasks,
      completion_rate: totalTasksToday > 0 ? completedTasks / totalTasksToday : 0,
    },
    followup_sequences: {
      should_have_advanced: 0, // TODO: Track sequence progression
      actually_advanced: 0,
      gap: 0,
    },
    disposition_gap: dispositionGap,
    scheduled_contacts: {
      planned: totalTasksToday,
      contacted: completedTasks,
      gap: missedTasks,
    },
  }
}

// ============================================================================
// RHY-03: WEEKLY REVIEW DATA
// ============================================================================

export interface WeeklyReviewData {
  week_start: string
  week_end: string
  pipeline_health: {
    leads_per_stage: PipelineSummary
    net_movement: {
      new_leads: number
      advanced: number
      stagnant: number
      dead: number
    }
    stagnation_flags: string[]
  }
  agent_scorecard: {
    calls_made: number
    meaningful_conversations: number
    talk_ratio: number
    dispositions_logged: number
    followups_completed: number
    followup_completion_rate: number
    leads_advanced: number
    trend_vs_prior_week: 'up' | 'down' | 'stable'
  }
  active_deals: {
    stage_4_plus: number
    total_mao: number
    total_offers: number
    avg_equity: number
  }
  revenue_expense: {
    revenue: number
    expenses: number
    net: number
  }
  system_health: {
    error_count: number
    worker_status: Record<string, 'healthy' | 'degraded' | 'down'>
    uptime: number
  }
  top_priorities: string[]
}

/**
 * Assemble weekly review data
 * Run on Friday afternoon or on-demand
 */
export async function getWeeklyReview(
  agentId: string = 'casey',
  weekStart?: string
): Promise<WeeklyReviewData> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Calculate week boundaries
  const today = new Date()
  const dayOfWeek = today.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(today)
  monday.setDate(today.getDate() + mondayOffset)
  const start = weekStart || monday.toISOString().split('T')[0]

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const end = sunday.toISOString().split('T')[0]

  // Pipeline health
  const { data: pipelineData } = await supabase
    .from('leads')
    .select('station, created_at')
    .not('station', 'eq', 'dead')

  const leadsPerStage: PipelineSummary = {
    new: 0,
    contacted: 0,
    qualified: 0,
    offer_made: 0,
    under_contract: 0,
    disposition: 0,
    closed: 0,
    total: pipelineData?.length || 0,
  }

  let newLeadsThisWeek = 0

  pipelineData?.forEach((lead: any) => {
    const stage = lead.station as keyof Omit<PipelineSummary, 'total'>
    if (stage && stage in leadsPerStage) {
      leadsPerStage[stage]++
    }

    // Count new leads this week
    const createdDate = new Date(lead.created_at)
    if (createdDate >= monday && createdDate <= sunday) {
      newLeadsThisWeek++
    }
  })

  // Agent scorecard
  const weekStats = await aggregateStats(agentId, start, end)
  const priorWeekStart = new Date(monday)
  priorWeekStart.setDate(monday.getDate() - 7)
  const priorWeekEnd = new Date(monday)
  priorWeekEnd.setDate(monday.getDate() - 1)
  const priorWeekStats = await aggregateStats(
    agentId,
    priorWeekStart.toISOString().split('T')[0],
    priorWeekEnd.toISOString().split('T')[0]
  )

  const talkRatio =
    weekStats.calls_made > 0
      ? weekStats.meaningful_conversations / weekStats.calls_made
      : 0

  const followupRate =
    weekStats.followups_completed + weekStats.followups_missed > 0
      ? weekStats.followups_completed /
        (weekStats.followups_completed + weekStats.followups_missed)
      : 0

  const callsTrend =
    weekStats.calls_made > priorWeekStats.calls_made
      ? 'up'
      : weekStats.calls_made < priorWeekStats.calls_made
      ? 'down'
      : 'stable'

  // Active deals (stage 4+)
  const { data: activeDeals } = await supabase
    .from('leads')
    .select('metadata')
    .in('station', ['offer_made', 'under_contract'])

  const totalMAO =
    activeDeals?.reduce((sum: number, deal: any) => {
      return sum + (deal.metadata?.mao || 0)
    }, 0) || 0

  // Top priorities (auto-generated)
  const priorities: string[] = []
  const mojoSessionAlert = await getMojoSessionSystemAlert(supabase)

  // Priority 1: Stagnant high-value leads
  const { data: stagnantLeads } = await supabase
    .from('leads')
    .select('id, full_name, station')
    .in('station', ['contacted', 'qualified'])
    .eq('priority', 'hot')
    .order('created_at', { ascending: true })
    .limit(1)

  if (stagnantLeads && stagnantLeads.length > 0) {
    priorities.push(
      `Advance ${stagnantLeads[0].full_name || 'hot lead'} from ${stagnantLeads[0].station} to next stage`
    )
  }

  // Priority 2: Overdue follow-ups
  if (weekStats.followups_missed > 5) {
    priorities.push(`Clear ${weekStats.followups_missed} overdue follow-up tasks`)
  }

  // Priority 3: Low talk ratio
  if (talkRatio < 0.15 && weekStats.calls_made > 20) {
    priorities.push(
      `Improve talk ratio (currently ${Math.round(talkRatio * 100)}%) - focus on optimal call windows`
    )
  }

  return {
    week_start: start,
    week_end: end,
    pipeline_health: {
      leads_per_stage: leadsPerStage,
      net_movement: {
        new_leads: newLeadsThisWeek,
        advanced: weekStats.leads_advanced,
        stagnant: weekStats.leads_stagnant,
        dead: 0, // TODO: Track dead leads this week
      },
      stagnation_flags: [], // TODO: Identify specific stagnant leads
    },
    agent_scorecard: {
      calls_made: weekStats.calls_made,
      meaningful_conversations: weekStats.meaningful_conversations,
      talk_ratio: talkRatio,
      dispositions_logged: weekStats.dispositions_logged,
      followups_completed: weekStats.followups_completed,
      followup_completion_rate: followupRate,
      leads_advanced: weekStats.leads_advanced,
      trend_vs_prior_week: callsTrend as 'up' | 'down' | 'stable',
    },
    active_deals: {
      stage_4_plus: activeDeals?.length || 0,
      total_mao: totalMAO,
      total_offers: activeDeals?.length || 0,
      avg_equity: 0, // TODO: Calculate from ARV - debt
    },
    revenue_expense: {
      revenue: 0, // TODO: Sum from closed deals
      expenses: 1775, // Seeded value from Night 1
      net: -1775,
    },
    system_health: {
      error_count: 0, // TODO: Track from error logs
      worker_status: {
        mojo_sync: mojoSessionAlert ? 'down' : 'healthy',
        email_delivery: 'healthy',
        sms_delivery: 'healthy',
      },
      uptime: 99.9,
    },
    top_priorities: priorities.slice(0, 3),
  }
}

/**
 * Store weekly review to database
 */
export async function saveWeeklyReview(
  review: WeeklyReviewData
): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { error } = await supabase.from('weekly_reviews').insert({
    week_start: review.week_start,
    week_end: review.week_end,
    pipeline_health: review.pipeline_health,
    agent_scorecard: review.agent_scorecard,
    active_deals: review.active_deals,
    revenue_expense: review.revenue_expense,
    system_health: review.system_health,
    top_priorities: review.top_priorities,
  })

  return !error
}

// ============================================================================
// SHOW RATE ALERTS
// ============================================================================

export interface ShowRateAlert {
  type: 'low_show_rate' | 'weekly_no_show_cluster' | 'ghost_protocol_today'
  priority: 'critical' | 'high' | 'medium'
  title: string
  description: string
  metadata: Record<string, any>
  lead_ids?: string[]
}

/**
 * Alert 1: Rolling 30-day show rate below 85%
 * Queries manifests with appointment outcomes (completed or no_show) in the
 * last 30 days and calculates the show rate. If below 85%, creates an alert
 * with root-cause breakdown by source and appointment type.
 */
export async function checkRollingShowRate(): Promise<ShowRateAlert | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()

  // Fetch all manifests that have an appointment with a terminal outcome
  const { data: manifests, error } = await supabase
    .from('manifests')
    .select('id, lead_id, manifest')
    .gte('updated_at', thirtyDaysAgo)

  if (error || !manifests) return null

  // Filter to manifests with appointment outcomes
  const withOutcomes = manifests.filter((m: any) => {
    const status = m.manifest?.pipeline?.appointment?.status
    return status === 'completed' || status === 'no_show'
  })

  if (withOutcomes.length === 0) return null

  let completed = 0
  let noShow = 0
  const bySource: Record<string, { completed: number; no_show: number }> = {}
  const byType: Record<string, { completed: number; no_show: number }> = {}

  for (const m of withOutcomes) {
    const appt = m.manifest?.pipeline?.appointment
    const status = appt?.status as 'completed' | 'no_show'
    const source = m.manifest?.leadInfo?.source || m.manifest?.contacts?.[0]?.source || 'unknown'
    const apptType = appt?.type || 'unknown'

    if (status === 'completed') completed++
    else noShow++

    // Aggregate by source
    if (!bySource[source]) bySource[source] = { completed: 0, no_show: 0 }
    bySource[source][status]++

    // Aggregate by type
    if (!byType[apptType]) byType[apptType] = { completed: 0, no_show: 0 }
    byType[apptType][status]++
  }

  const showRate = (completed / (completed + noShow)) * 100

  if (showRate >= 85) return null

  // Build root cause analysis
  const worstSources = Object.entries(bySource)
    .map(([source, counts]) => ({
      source,
      rate: counts.completed / (counts.completed + counts.no_show) * 100,
      total: counts.completed + counts.no_show,
    }))
    .sort((a, b) => a.rate - b.rate)

  const worstTypes = Object.entries(byType)
    .map(([type, counts]) => ({
      type,
      rate: counts.completed / (counts.completed + counts.no_show) * 100,
      total: counts.completed + counts.no_show,
    }))
    .sort((a, b) => a.rate - b.rate)

  const sourceBreakdown = worstSources
    .map((s) => `${s.source}: ${s.rate.toFixed(0)}% (${s.total} appts)`)
    .join(', ')

  const typeBreakdown = worstTypes
    .map((t) => `${t.type}: ${t.rate.toFixed(0)}% (${t.total} appts)`)
    .join(', ')

  return {
    type: 'low_show_rate',
    priority: showRate < 70 ? 'critical' : 'high',
    title: `Show rate ${showRate.toFixed(1)}% — below 85% threshold`,
    description: [
      `Rolling 30-day show rate: ${completed}/${completed + noShow} appointments kept.`,
      `By source: ${sourceBreakdown}`,
      `By type: ${typeBreakdown}`,
    ].join('\n'),
    metadata: {
      show_rate: showRate,
      completed,
      no_show: noShow,
      by_source: bySource,
      by_type: byType,
      worst_sources: worstSources,
      worst_types: worstTypes,
      window_days: 30,
    },
  }
}

/**
 * Alert 2: 3+ no-shows in a single week
 * Scans auditTrail entries across all manifests for no_show outcomes
 * in the current Monday–Sunday window.
 */
export async function checkWeeklyNoShowCluster(): Promise<ShowRateAlert | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Calculate current week boundaries (Monday–Sunday)
  const today = new Date()
  const dayOfWeek = today.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(today)
  monday.setDate(today.getDate() + mondayOffset)
  monday.setHours(0, 0, 0, 0)

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)

  const mondayISO = monday.toISOString()
  const sundayISO = sunday.toISOString()

  // Fetch manifests updated this week that might have no_show audit entries
  const { data: manifests, error } = await supabase
    .from('manifests')
    .select('id, lead_id, manifest')
    .gte('updated_at', mondayISO)

  if (error || !manifests) return null

  interface NoShowEntry {
    lead_id: string
    manifest_id: string
    lead_name: string
    timestamp: string
    address: string | null
  }

  const noShows: NoShowEntry[] = []

  for (const m of manifests) {
    const trail: Array<{ timestamp: string; action: string; [k: string]: any }> =
      m.manifest?.auditTrail || []

    for (const entry of trail) {
      // Match audit entries that indicate a no_show outcome this week
      const entryTime = new Date(entry.timestamp)
      if (entryTime < monday || entryTime > sunday) continue

      const isNoShow =
        entry.action === 'no_show' ||
        entry.action === 'appointment_no_show' ||
        (entry.details && typeof entry.details === 'string' && entry.details.toLowerCase().includes('no_show')) ||
        (entry.details && typeof entry.details === 'string' && entry.details.toLowerCase().includes('no show'))

      if (isNoShow) {
        noShows.push({
          lead_id: m.lead_id,
          manifest_id: m.id,
          lead_name: m.manifest?.leadInfo?.name || m.manifest?.contacts?.[0]?.name || 'Unknown',
          timestamp: entry.timestamp,
          address: m.manifest?.property?.address || null,
        })
      }
    }

    // Also check if the appointment status itself is no_show and was set this week
    const appt = m.manifest?.pipeline?.appointment
    if (appt?.status === 'no_show') {
      // Check if the manifest was updated this week (proxy for when it became no_show)
      const alreadyCounted = noShows.some((ns) => ns.manifest_id === m.id)
      if (!alreadyCounted) {
        noShows.push({
          lead_id: m.lead_id,
          manifest_id: m.id,
          lead_name: m.manifest?.leadInfo?.name || m.manifest?.contacts?.[0]?.name || 'Unknown',
          timestamp: m.manifest?.lastUpdated || mondayISO,
          address: m.manifest?.property?.address || null,
        })
      }
    }
  }

  if (noShows.length < 3) return null

  const names = noShows.map((ns) => ns.lead_name).join(', ')

  return {
    type: 'weekly_no_show_cluster',
    priority: noShows.length >= 5 ? 'critical' : 'high',
    title: `${noShows.length} no-shows this week — pattern detected`,
    description: [
      `${noShows.length} appointment no-shows since Monday:`,
      ...noShows.map((ns) => `  - ${ns.lead_name}${ns.address ? ` (${ns.address})` : ''} at ${new Date(ns.timestamp).toLocaleDateString()}`),
      '',
      'Review appointment confirmation workflow and consider adjusting ghost risk thresholds.',
    ].join('\n'),
    metadata: {
      no_show_count: noShows.length,
      no_shows: noShows,
      week_start: mondayISO,
      week_end: sundayISO,
    },
    lead_ids: noShows.map((ns) => ns.lead_id),
  }
}

/**
 * Alert 3: Same-day Ghost Protocol activation
 * Checks if any appointment scheduled for today has ghostProtocolActive === true.
 * This is an immediate-priority alert since it means a seller is going cold
 * on a same-day appointment.
 */
export async function checkSameDayGhostProtocol(): Promise<ShowRateAlert[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const today = new Date().toISOString().split('T')[0]

  // Fetch all manifests — we need to check the JSONB appointment fields
  const { data: manifests, error } = await supabase
    .from('manifests')
    .select('id, lead_id, manifest')

  if (error || !manifests) return []

  const alerts: ShowRateAlert[] = []

  for (const m of manifests) {
    const appt = m.manifest?.pipeline?.appointment
    if (!appt) continue

    // Check if appointment is scheduled for today
    const scheduledDate = appt.scheduledAt?.split('T')[0]
    if (scheduledDate !== today) continue

    // Check if ghost protocol is active
    if (!appt.ghostProtocolActive) continue

    const leadName = m.manifest?.leadInfo?.name || m.manifest?.contacts?.[0]?.name || 'Unknown'
    const address = m.manifest?.property?.address || null
    const scheduledTime = new Date(appt.scheduledAt).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })

    alerts.push({
      type: 'ghost_protocol_today',
      priority: 'critical',
      title: `Ghost Protocol active — ${leadName} appointment at ${scheduledTime}`,
      description: [
        `${leadName} has ghost protocol active for today's ${appt.type || 'appointment'} at ${scheduledTime}.`,
        address ? `Property: ${address}` : '',
        `Ghost risk score: ${appt.ghostRiskScore ?? 'N/A'}`,
        `Last seller response: ${appt.lastSellerResponse ? new Date(appt.lastSellerResponse).toLocaleString() : 'None'}`,
        `Confirmation count: ${appt.confirmationCount ?? 0}`,
        '',
        'Immediate action required — seller is going cold.',
      ].filter(Boolean).join('\n'),
      metadata: {
        manifest_id: m.id,
        appointment_type: appt.type,
        scheduled_at: appt.scheduledAt,
        ghost_risk_score: appt.ghostRiskScore,
        ghost_protocol_active: true,
        last_seller_response: appt.lastSellerResponse,
        confirmation_count: appt.confirmationCount,
        automation_log: appt.automationLog,
      },
      lead_ids: [m.lead_id],
    })
  }

  return alerts
}

/**
 * Run all show rate alert checks and publish to ari_briefing_events.
 * Call from a cron/worker or the morning briefing flow.
 */
export async function runShowRateAlerts(): Promise<{
  alerts_created: number
  alerts: ShowRateAlert[]
}> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const allAlerts: ShowRateAlert[] = []

  // Run all three checks in parallel
  const [rollingRate, weeklyCluster, ghostToday] = await Promise.all([
    checkRollingShowRate(),
    checkWeeklyNoShowCluster(),
    checkSameDayGhostProtocol(),
  ])

  if (rollingRate) allAlerts.push(rollingRate)
  if (weeklyCluster) allAlerts.push(weeklyCluster)
  allAlerts.push(...ghostToday)

  // Publish each alert as an ari_briefing_event
  for (const alert of allAlerts) {
    await supabase.from('ari_briefing_events').insert({
      event_type: 'show_rate_alert',
      priority: alert.priority,
      title: alert.title,
      description: alert.description,
      lead_id: alert.lead_ids?.[0] || null,
      action_url: alert.lead_ids?.[0] ? `/leads/${alert.lead_ids[0]}` : null,
      metadata: {
        ...alert.metadata,
        alert_type: alert.type,
        all_lead_ids: alert.lead_ids,
      },
      read: false,
      dismissed: false,
      created_at: new Date().toISOString(),
    })
  }

  return { alerts_created: allAlerts.length, alerts: allAlerts }
}
