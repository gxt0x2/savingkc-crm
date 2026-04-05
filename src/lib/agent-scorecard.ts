import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface ScorecardMetric {
  label: string
  current: number
  target: number
  percentage: number
  trend?: 'up' | 'flat' | 'down'
  color: 'green' | 'amber' | 'red'
}

export interface AgentScorecard {
  agent_id: string
  agent_name: string
  period: 'daily' | 'weekly'
  date: string
  metrics: ScorecardMetric[]
  overall_performance: number // 0-100
}

/**
 * AUD-02: Agent Scorecard
 * Generates daily or weekly scorecard for an agent with KPI targets
 */
export async function generateAgentScorecard(
  agentId: string,
  period: 'daily' | 'weekly' = 'daily'
): Promise<AgentScorecard | null> {
  try {
    // Get agent role to fetch KPI targets
    const { data: user } = await supabase
      .from('users')
      .select('name, role_id, roles(kpi_targets)')
      .eq('id', agentId)
      .single()

    if (!user) return null

    const kpiTargets = (user as any).roles?.kpi_targets || {}
    const agentName = user.name || 'Unknown Agent'

    // Get stats for the period
    let stats
    let comparisonStats

    if (period === 'daily') {
      const today = new Date().toISOString().split('T')[0]
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const { data: todayStats } = await supabase
        .from('agent_daily_stats')
        .select('*')
        .eq('agent_id', agentId)
        .eq('date', today)
        .single()

      const { data: yesterdayStats } = await supabase
        .from('agent_daily_stats')
        .select('*')
        .eq('agent_id', agentId)
        .eq('date', yesterday)
        .single()

      stats = todayStats
      comparisonStats = yesterdayStats
    } else {
      // Weekly - aggregate last 7 days
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const { data: thisWeek } = await supabase
        .from('agent_daily_stats')
        .select('*')
        .eq('agent_id', agentId)
        .gte('date', weekAgo)

      const { data: lastWeek } = await supabase
        .from('agent_daily_stats')
        .select('*')
        .eq('agent_id', agentId)
        .gte('date', twoWeeksAgo)
        .lt('date', weekAgo)

      stats = aggregateStats(thisWeek || [])
      comparisonStats = aggregateStats(lastWeek || [])
    }

    if (!stats) return null

    // Build metrics
    const metrics: ScorecardMetric[] = []

    // Calls Made
    if (kpiTargets.daily_call_volume || kpiTargets.weekly_call_volume) {
      const target = period === 'daily' ? kpiTargets.daily_call_volume : kpiTargets.weekly_call_volume * 5
      const current = stats.calls_made || 0
      metrics.push(createMetric('Calls Made', current, target, comparisonStats?.calls_made))
    }

    // Meaningful Conversations
    if (kpiTargets.meaningful_conversation_rate_pct) {
      const current = stats.calls_made > 0 ? (stats.meaningful_conversations / stats.calls_made) * 100 : 0
      const target = kpiTargets.meaningful_conversation_rate_pct
      const comparison =
        comparisonStats && comparisonStats.calls_made > 0
          ? (comparisonStats.meaningful_conversations / comparisonStats.calls_made) * 100
          : null
      metrics.push(createMetric('Conversation Rate', current, target, comparison, '%'))
    }

    // Disposition Rate
    if (kpiTargets.disposition_logging_rate_pct) {
      const current = stats.calls_made > 0 ? (stats.dispositions_logged / stats.calls_made) * 100 : 0
      const target = kpiTargets.disposition_logging_rate_pct
      const comparison =
        comparisonStats && comparisonStats.calls_made > 0
          ? (comparisonStats.dispositions_logged / comparisonStats.calls_made) * 100
          : null
      metrics.push(createMetric('Disposition Rate', current, target, comparison, '%'))
    }

    // Follow-up Completion Rate
    if (kpiTargets.followup_completion_rate_pct) {
      const totalFollowups = (stats.followups_completed || 0) + (stats.followups_missed || 0)
      const current = totalFollowups > 0 ? (stats.followups_completed / totalFollowups) * 100 : 0
      const target = kpiTargets.followup_completion_rate_pct

      const comparisonTotal =
        (comparisonStats?.followups_completed || 0) + (comparisonStats?.followups_missed || 0)
      const comparison =
        comparisonStats && comparisonTotal > 0
          ? (comparisonStats.followups_completed / comparisonTotal) * 100
          : null

      metrics.push(createMetric('Follow-up Completion', current, target, comparison, '%'))
    }

    // Leads Advanced
    const current = stats.leads_advanced || 0
    const target = period === 'daily' ? 2 : 10 // Reasonable defaults
    metrics.push(createMetric('Leads Advanced', current, target, comparisonStats?.leads_advanced))

    // Calculate overall performance (average of all metric percentages)
    const overallPerformance =
      metrics.reduce((sum, m) => sum + m.percentage, 0) / (metrics.length || 1)

    return {
      agent_id: agentId,
      agent_name: agentName,
      period,
      date: new Date().toISOString().split('T')[0],
      metrics,
      overall_performance: Math.round(overallPerformance),
    }
  } catch (err) {
    console.error('Error generating agent scorecard:', err)
    return null
  }
}

function createMetric(
  label: string,
  current: number,
  target: number,
  comparison: number | null | undefined,
  suffix: string = ''
): ScorecardMetric {
  const percentage = target > 0 ? (current / target) * 100 : 0
  const color: 'green' | 'amber' | 'red' =
    percentage >= 90 ? 'green' : percentage >= 60 ? 'amber' : 'red'

  let trend: 'up' | 'flat' | 'down' | undefined
  if (comparison !== null && comparison !== undefined) {
    if (current > comparison * 1.05) trend = 'up'
    else if (current < comparison * 0.95) trend = 'down'
    else trend = 'flat'
  }

  return {
    label,
    current: suffix === '%' ? Math.round(current) : current,
    target: suffix === '%' ? Math.round(target) : target,
    percentage: Math.round(percentage),
    trend,
    color,
  }
}

function aggregateStats(stats: any[]): any {
  if (stats.length === 0) return null

  return {
    calls_made: stats.reduce((sum, s) => sum + (s.calls_made || 0), 0),
    meaningful_conversations: stats.reduce((sum, s) => sum + (s.meaningful_conversations || 0), 0),
    dispositions_logged: stats.reduce((sum, s) => sum + (s.dispositions_logged || 0), 0),
    followups_completed: stats.reduce((sum, s) => sum + (s.followups_completed || 0), 0),
    followups_missed: stats.reduce((sum, s) => sum + (s.followups_missed || 0), 0),
    leads_advanced: stats.reduce((sum, s) => sum + (s.leads_advanced || 0), 0),
    leads_stagnant: stats.reduce((sum, s) => sum + (s.leads_stagnant || 0), 0),
  }
}

/**
 * AUD-05: Accountability Timeline
 * Builds expected vs actual timeline for a lead
 */
export interface TimelineEvent {
  date: string
  expected_action: string
  actual_action: string | null
  status: 'completed_on_time' | 'completed_late' | 'missed'
  days_late?: number
}

export async function generateAccountabilityTimeline(leadId: string): Promise<TimelineEvent[]> {
  const timeline: TimelineEvent[] = []

  // Get the lead's follow-up sequence
  const { data: enrollments } = await supabase
    .from('lead_activities')
    .select('metadata, created_at')
    .eq('lead_id', leadId)
    .eq('type', 'followup_enrollment')
    .order('created_at', { ascending: true })
    .limit(1)

  if (!enrollments || enrollments.length === 0) return timeline

  const enrollment = enrollments[0]
  const sequenceType = enrollment.metadata?.sequence_type

  // Get all tasks for this lead
  const { data: tasks } = await supabase
    .from('lead_activities')
    .select('*')
    .eq('lead_id', leadId)
    .eq('type', 'task')
    .order('created_at', { ascending: true })

  if (!tasks) return timeline

  // Build expected timeline based on sequence
  const enrollmentDate = new Date(enrollment.created_at)
  const expectedTasks = getExpectedTasksForSequence(sequenceType, enrollmentDate)

  // Match expected with actual
  for (const expected of expectedTasks) {
    const actualTask = tasks.find(
      (t) =>
        Math.abs(new Date(t.metadata?.due_date || t.created_at).getTime() - expected.date.getTime()) <
        24 * 60 * 60 * 1000 // Within 1 day
    )

    let status: 'completed_on_time' | 'completed_late' | 'missed' = 'missed'
    let daysLate: number | undefined

    if (actualTask) {
      const completedDate = actualTask.metadata?.completed_at
        ? new Date(actualTask.metadata.completed_at)
        : null

      if (completedDate) {
        const dueDate = new Date(actualTask.metadata?.due_date || actualTask.created_at)
        const lateDays = Math.floor((completedDate.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000))

        if (lateDays <= 0) {
          status = 'completed_on_time'
        } else {
          status = 'completed_late'
          daysLate = lateDays
        }
      } else if (new Date() > new Date(actualTask.metadata?.due_date || actualTask.created_at)) {
        status = 'missed'
      }
    }

    timeline.push({
      date: expected.date.toISOString().split('T')[0],
      expected_action: expected.action,
      actual_action: actualTask ? actualTask.description : null,
      status,
      days_late: daysLate,
    })
  }

  return timeline
}

// ---------------------------------------------------------------------------
// Ghost Risk Score Model Validation (READ-only)
// ---------------------------------------------------------------------------

export interface GhostRiskValidation {
  avgScoreAtShow: number          // Average ghostRiskScore at appointment time for completed
  avgScoreAtNoShow: number        // Average ghostRiskScore at appointment time for no_shows
  spread: number                  // Difference (should be > 15 to be predictive)
  isPredictive: boolean           // spread >= 15
  sampleSize: number              // Total appointments with outcomes
  topFactors: Array<{             // Which factors correlate most with no-shows
    factor: string
    correlation: 'strong' | 'moderate' | 'weak'
  }>
}

/**
 * Analyzes historical appointment outcomes to validate ghost risk score model.
 * READ-only — queries manifests table, computes stats, returns validation object.
 */
export async function getGhostRiskValidation(): Promise<GhostRiskValidation> {
  // Fetch all manifests that have an appointment with a terminal outcome
  const { data: rows, error } = await supabase
    .from('manifests')
    .select('manifest')

  if (error) {
    console.error('[ghost-risk-validation] Query error:', error)
    return emptyValidation()
  }

  if (!rows || rows.length === 0) {
    return emptyValidation()
  }

  // Filter to manifests with appointment outcomes
  const completed: { score: number; log: any[] }[] = []
  const noShows: { score: number; log: any[] }[] = []

  for (const row of rows) {
    const m = row.manifest as any
    const appt = m?.pipeline?.appointment
    if (!appt) continue

    const status = appt.status
    if (status !== 'completed' && status !== 'no_show') continue

    const score = appt.ghostRiskScore ?? 0
    const log = appt.automationLog || []

    if (status === 'completed') {
      completed.push({ score, log })
    } else {
      noShows.push({ score, log })
    }
  }

  const sampleSize = completed.length + noShows.length
  if (sampleSize === 0) {
    return emptyValidation()
  }

  const avgScoreAtShow = completed.length > 0
    ? completed.reduce((sum, c) => sum + c.score, 0) / completed.length
    : 0
  const avgScoreAtNoShow = noShows.length > 0
    ? noShows.reduce((sum, c) => sum + c.score, 0) / noShows.length
    : 0

  const spread = avgScoreAtNoShow - avgScoreAtShow

  // Analyze which factors appear more in no-shows vs completed
  const topFactors = analyzeFactorCorrelations(completed, noShows)

  return {
    avgScoreAtShow: Math.round(avgScoreAtShow * 10) / 10,
    avgScoreAtNoShow: Math.round(avgScoreAtNoShow * 10) / 10,
    spread: Math.round(spread * 10) / 10,
    isPredictive: spread >= 15,
    sampleSize,
    topFactors,
  }
}

function emptyValidation(): GhostRiskValidation {
  return {
    avgScoreAtShow: 0,
    avgScoreAtNoShow: 0,
    spread: 0,
    isPredictive: false,
    sampleSize: 0,
    topFactors: [],
  }
}

/**
 * Checks each ghost risk factor's prevalence in no-shows vs completed.
 * A factor is "strong" if it appears 2x+ more in no-shows, "moderate" if 1.3-2x, "weak" otherwise.
 */
function analyzeFactorCorrelations(
  completed: { score: number; log: any[] }[],
  noShows: { score: number; log: any[] }[],
): GhostRiskValidation['topFactors'] {
  // Factor definitions matching ghost-risk-calculator.ts
  const factors = [
    {
      name: 'unanswered_confirmations',
      detect: (log: any[]) => log.some((e: any) => e.action?.includes('confirm') && !e.sellerResponded),
    },
    {
      name: 'no_seller_response',
      detect: (log: any[]) => log.length > 0 && log.every((e: any) => !e.sellerResponded),
    },
    {
      name: 'ambiguous_reply',
      detect: (log: any[]) => log.some((e: any) => e.sellerResponded && e.action?.includes('ambiguous')),
    },
    {
      name: 'ghost_protocol_activated',
      detect: (log: any[]) => log.some((e: any) => e.action?.startsWith('ghost_step_')),
    },
    {
      name: 'multiple_reminders_ignored',
      detect: (log: any[]) => log.filter((e: any) => e.action?.includes('confirm') && !e.sellerResponded).length >= 2,
    },
  ]

  const results: GhostRiskValidation['topFactors'] = []
  const completedTotal = completed.length || 1 // avoid division by zero
  const noShowTotal = noShows.length || 1

  for (const factor of factors) {
    const completedRate = completed.filter(c => factor.detect(c.log)).length / completedTotal
    const noShowRate = noShows.filter(c => factor.detect(c.log)).length / noShowTotal

    // Skip if neither group has this factor
    if (completedRate === 0 && noShowRate === 0) continue

    const ratio = completedRate > 0 ? noShowRate / completedRate : noShowRate > 0 ? 3 : 0
    let correlation: 'strong' | 'moderate' | 'weak'
    if (ratio >= 2) correlation = 'strong'
    else if (ratio >= 1.3) correlation = 'moderate'
    else correlation = 'weak'

    results.push({ factor: factor.name, correlation })
  }

  // Sort strong first, then moderate, then weak
  const order = { strong: 0, moderate: 1, weak: 2 }
  results.sort((a, b) => order[a.correlation] - order[b.correlation])

  return results
}

function getExpectedTasksForSequence(
  sequenceType: string,
  startDate: Date
): { date: Date; action: string }[] {
  const tasks: { date: Date; action: string }[] = []

  // Define expected cadences for different sequences
  const sequences: Record<string, { day: number; action: string }[]> = {
    no_answer: [
      { day: 1, action: 'Follow-up call' },
      { day: 3, action: 'SMS check-in' },
    ],
    left_vm: [
      { day: 2, action: 'Follow-up call' },
      { day: 4, action: 'Email' },
    ],
    callback_requested: [{ day: 0, action: 'Callback at requested time' }],
    deal_potential: [
      { day: 1, action: 'Follow-up call' },
      { day: 3, action: 'Property research & comps' },
      { day: 5, action: 'Offer preparation' },
    ],
    not_interested: [
      { day: 90, action: 'Re-engagement check' },
      { day: 180, action: 'Long-term nurture touch' },
    ],
  }

  const sequence = sequences[sequenceType] || []

  for (const task of sequence) {
    const taskDate = new Date(startDate)
    taskDate.setDate(taskDate.getDate() + task.day)
    tasks.push({ date: taskDate, action: task.action })
  }

  return tasks
}
