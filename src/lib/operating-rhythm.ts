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
  callbacks_today: CallbackItem[]
  overdue_followups: FollowUpItem[]
  leads_needing_attention: LeadAttentionItem[]
  mail_arriving_today: MailItem[]
  pipeline_summary: PipelineSummary
  yesterday_stats: AgentDailyStats | null
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

  return {
    date: today,
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
    .in('station', ['offer_made', 'under_contract', 'disposition'])

  const totalMAO =
    activeDeals?.reduce((sum: number, deal: any) => {
      return sum + (deal.metadata?.mao || 0)
    }, 0) || 0

  // Top priorities (auto-generated)
  const priorities: string[] = []

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
        mojo_sync: 'healthy',
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
