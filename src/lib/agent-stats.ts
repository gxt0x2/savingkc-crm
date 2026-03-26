/**
 * ARI CRM - Agent Daily Stats
 * Night 3: Ari Intelligence - ARI-04
 *
 * Pattern Analysis Preparation & Daily Stats Aggregation
 */

import { createClient } from '@supabase/supabase-js'

export interface AgentDailyStats {
  agent_id: string
  date: string
  calls_made: number
  meaningful_conversations: number
  dispositions_logged: number
  followups_completed: number
  followups_missed: number
  leads_advanced: number
  leads_stagnant: number
  metadata?: Record<string, any>
}

/**
 * Get today's stats for an agent (or create if doesn't exist)
 */
export async function getTodayStats(
  agentId: string
): Promise<AgentDailyStats | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const today = new Date().toISOString().split('T')[0]

  const { data } = await supabase
    .from('agent_daily_stats')
    .select('*')
    .eq('agent_id', agentId)
    .eq('date', today)
    .single()

  if (data) {
    return data as AgentDailyStats
  }

  // Create today's record
  const { data: newStats } = await supabase
    .from('agent_daily_stats')
    .insert({
      agent_id: agentId,
      date: today,
      calls_made: 0,
      meaningful_conversations: 0,
      dispositions_logged: 0,
      followups_completed: 0,
      followups_missed: 0,
      leads_advanced: 0,
      leads_stagnant: 0,
    })
    .select()
    .single()

  return (newStats as AgentDailyStats) || null
}

/**
 * Increment a stat counter
 */
export async function incrementStat(
  agentId: string,
  statName: keyof Omit<AgentDailyStats, 'agent_id' | 'date' | 'metadata'>,
  amount: number = 1
): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const today = new Date().toISOString().split('T')[0]

  // Upsert: increment if exists, create if not
  const { error } = await supabase.rpc('increment_agent_stat', {
    p_agent_id: agentId,
    p_date: today,
    p_stat_name: statName,
    p_amount: amount,
  })

  // If RPC doesn't exist, fall back to manual upsert
  if (error && error.message.includes('does not exist')) {
    const stats = await getTodayStats(agentId)
    if (!stats) return false

    const newValue = (stats[statName] as number) + amount

    const { error: updateError } = await supabase
      .from('agent_daily_stats')
      .update({ [statName]: newValue })
      .eq('agent_id', agentId)
      .eq('date', today)

    return !updateError
  }

  return !error
}

/**
 * Log a call made
 */
export async function logCallMade(
  agentId: string,
  wasMeaningful: boolean = false
) {
  await incrementStat(agentId, 'calls_made', 1)
  if (wasMeaningful) {
    await incrementStat(agentId, 'meaningful_conversations', 1)
  }
}

/**
 * Log disposition
 */
export async function logDisposition(agentId: string) {
  await incrementStat(agentId, 'dispositions_logged', 1)
}

/**
 * Log follow-up completion
 */
export async function logFollowUpCompleted(agentId: string) {
  await incrementStat(agentId, 'followups_completed', 1)
}

/**
 * Log follow-up missed
 */
export async function logFollowUpMissed(agentId: string) {
  await incrementStat(agentId, 'followups_missed', 1)
}

/**
 * Log lead advancement
 */
export async function logLeadAdvanced(agentId: string) {
  await incrementStat(agentId, 'leads_advanced', 1)
}

/**
 * Get stats for a date range
 */
export async function getStatsRange(
  agentId: string,
  startDate: string,
  endDate: string
): Promise<AgentDailyStats[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data } = await supabase
    .from('agent_daily_stats')
    .select('*')
    .eq('agent_id', agentId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false })

  return (data as AgentDailyStats[]) || []
}

/**
 * Aggregate stats for a period
 */
export async function aggregateStats(
  agentId: string,
  startDate: string,
  endDate: string
): Promise<AgentDailyStats> {
  const stats = await getStatsRange(agentId, startDate, endDate)

  return stats.reduce(
    (acc, day) => ({
      agent_id: agentId,
      date: `${startDate} to ${endDate}`,
      calls_made: acc.calls_made + day.calls_made,
      meaningful_conversations:
        acc.meaningful_conversations + day.meaningful_conversations,
      dispositions_logged: acc.dispositions_logged + day.dispositions_logged,
      followups_completed: acc.followups_completed + day.followups_completed,
      followups_missed: acc.followups_missed + day.followups_missed,
      leads_advanced: acc.leads_advanced + day.leads_advanced,
      leads_stagnant: acc.leads_stagnant + day.leads_stagnant,
    }),
    {
      agent_id: agentId,
      date: `${startDate} to ${endDate}`,
      calls_made: 0,
      meaningful_conversations: 0,
      dispositions_logged: 0,
      followups_completed: 0,
      followups_missed: 0,
      leads_advanced: 0,
      leads_stagnant: 0,
    }
  )
}

/**
 * Calculate key ratios from stats (for pattern analysis)
 */
export function calculateRatios(stats: AgentDailyStats) {
  return {
    talk_ratio:
      stats.calls_made > 0
        ? stats.meaningful_conversations / stats.calls_made
        : 0,
    disposition_rate:
      stats.calls_made > 0 ? stats.dispositions_logged / stats.calls_made : 0,
    followup_completion_rate:
      stats.followups_completed + stats.followups_missed > 0
        ? stats.followups_completed /
          (stats.followups_completed + stats.followups_missed)
        : 0,
    advancement_rate:
      stats.leads_advanced + stats.leads_stagnant > 0
        ? stats.leads_advanced / (stats.leads_advanced + stats.leads_stagnant)
        : 0,
  }
}

/**
 * Generate coaching insight based on stats pattern
 * Placeholder for future Anthropic API integration
 */
export function generateCoachingInsight(stats: AgentDailyStats): string {
  const ratios = calculateRatios(stats)

  // Simple rule-based coaching for now
  // TODO: Replace with Anthropic API call in Night 5

  if (ratios.talk_ratio < 0.1 && stats.calls_made > 20) {
    return `Low talk ratio (${Math.round(ratios.talk_ratio * 100)}%). ${stats.calls_made} calls but only ${stats.meaningful_conversations} meaningful conversations. Consider calling during optimal hours or reviewing contact quality.`
  }

  if (ratios.disposition_rate < 0.5 && stats.calls_made > 10) {
    return `Missing dispositions on ${stats.calls_made - stats.dispositions_logged} calls. Log outcomes immediately after each call to maintain data quality.`
  }

  if (ratios.followup_completion_rate < 0.7 && stats.followups_missed > 0) {
    return `Follow-up completion at ${Math.round(ratios.followup_completion_rate * 100)}%. ${stats.followups_missed} tasks missed. Review daily task list at start of day.`
  }

  if (ratios.advancement_rate < 0.3 && stats.leads_advanced > 0) {
    return `Most leads stagnant (${stats.leads_stagnant} vs ${stats.leads_advanced} advanced). Focus on pillar completion and offer preparation.`
  }

  return 'Strong performance across all metrics. Keep up the momentum.'
}

/**
 * FUTURE: Anthropic API integration placeholder
 * This is where Night 5 will plug in the AI-powered coaching
 */
export interface AnthropicCoachingPayload {
  agent_id: string
  stats_summary: AgentDailyStats[]
  recent_activities: any[]
  lead_pipeline: any[]
}

export async function generateAICoaching(
  payload: AnthropicCoachingPayload
): Promise<string> {
  // TODO: Night 5 - Anthropic API call
  // const response = await anthropic.messages.create({
  //   model: 'claude-sonnet-4-6',
  //   system: 'You are Ari, the AI Chief of Staff for a real estate wholesaling CRM...',
  //   messages: [
  //     {
  //       role: 'user',
  //       content: JSON.stringify(payload)
  //     }
  //   ]
  // })

  return generateCoachingInsight(payload.stats_summary[0])
}
