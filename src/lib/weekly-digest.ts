/**
 * ARI CRM - Weekly System Health Digest
 * Night 6: FBK-09
 * Generates comprehensive weekly summary for Monday morning briefing
 */

import { createClient } from '@supabase/supabase-js'

export interface WeeklyDigest {
  week_start: string
  week_end: string
  items_shipped: {
    count: number
    items: { id: string; description: string; resolved_at: string }[]
  }
  bugs: {
    resolved: number
    new_found: number
    still_open: number
  }
  worker_health: {
    healthy: number
    degraded: number
    down: number
    summary: string
  }
  error_rate: {
    total_errors: number
    avg_per_day: number
    trend: 'up' | 'down' | 'stable'
  }
  recommendations: string[]
}

type StoredWeeklyDigestHealth = {
  items_shipped?: number
  bugs_resolved?: number
  bugs_new?: number
  bugs_open?: number
  worker_health?: WeeklyDigest['worker_health']
  error_rate?: WeeklyDigest['error_rate']
  recommendations?: string[]
}

/**
 * Generate weekly system health digest
 */
export async function generateWeeklyDigest(
  weekStart: Date,
  weekEnd: Date
): Promise<WeeklyDigest | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const weekStartStr = weekStart.toISOString().split('T')[0]
  const weekEndStr = weekEnd.toISOString().split('T')[0]

  // Fetch items shipped this week
  const { data: shippedItems } = await supabase
    .from('feedback_submissions')
    .select('id, description, resolved_at')
    .gte('resolved_at', weekStartStr)
    .lte('resolved_at', weekEndStr)
    .eq('status', 'resolved')

  // Fetch bugs
  const { data: bugsResolved } = await supabase
    .from('feedback_submissions')
    .select('id')
    .eq('type', 'bug')
    .gte('resolved_at', weekStartStr)
    .lte('resolved_at', weekEndStr)

  const { data: bugsFound } = await supabase
    .from('feedback_submissions')
    .select('id')
    .eq('type', 'bug')
    .gte('created_at', weekStartStr)
    .lte('created_at', weekEndStr)

  const { data: bugsOpen } = await supabase
    .from('feedback_submissions')
    .select('id')
    .eq('type', 'bug')
    .in('status', ['open', 'acknowledged', 'in_progress'])

  // Fetch worker health
  const { data: workers } = await supabase
    .from('system_workers')
    .select('name, status, last_success, check_interval_minutes')

  let healthyCount = 0
  let degradedCount = 0
  let downCount = 0

  workers?.forEach((worker) => {
    if (!worker.last_success) {
      downCount++
      return
    }

    const lastSuccess = new Date(worker.last_success)
    const now = new Date()
    const minutesSinceSuccess =
      (now.getTime() - lastSuccess.getTime()) / 1000 / 60

    if (minutesSinceSuccess > worker.check_interval_minutes * 4) {
      downCount++
    } else if (minutesSinceSuccess > worker.check_interval_minutes * 2) {
      degradedCount++
    } else {
      healthyCount++
    }
  })

  const workerSummary =
    downCount > 0
      ? `${downCount} workers down - immediate attention required`
      : degradedCount > 0
        ? `${degradedCount} workers degraded`
        : 'All systems healthy'

  // Fetch error rate
  const { data: errors } = await supabase
    .from('error_log')
    .select('id, created_at')
    .gte('created_at', weekStartStr)
    .lte('created_at', weekEndStr)

  const totalErrors = errors?.length || 0
  const daysInWeek = 7
  const avgPerDay = Math.round(totalErrors / daysInWeek)

  // Calculate trend (compare to previous week)
  const prevWeekStart = new Date(weekStart)
  prevWeekStart.setDate(prevWeekStart.getDate() - 7)
  const prevWeekEnd = new Date(weekEnd)
  prevWeekEnd.setDate(prevWeekEnd.getDate() - 7)

  const { data: prevErrors } = await supabase
    .from('error_log')
    .select('id')
    .gte('created_at', prevWeekStart.toISOString().split('T')[0])
    .lte('created_at', prevWeekEnd.toISOString().split('T')[0])

  const prevWeekTotal = prevErrors?.length || 0
  let trend: 'up' | 'down' | 'stable' = 'stable'
  if (totalErrors > prevWeekTotal * 1.1) {
    trend = 'up'
  } else if (totalErrors < prevWeekTotal * 0.9) {
    trend = 'down'
  }

  // Generate recommendations
  const recommendations: string[] = []

  if (downCount > 0) {
    recommendations.push(
      `CRITICAL: ${downCount} system workers are down. Check system health dashboard immediately.`
    )
  }

  if ((bugsOpen?.length || 0) > 5) {
    recommendations.push(
      `${bugsOpen?.length} open bugs. Consider allocating time for bug fixes this week.`
    )
  }

  if (trend === 'up') {
    recommendations.push(
      'Error rate is trending up. Review error log for patterns.'
    )
  }

  if ((shippedItems?.length || 0) === 0) {
    recommendations.push('No items shipped this week. Review development velocity.')
  }

  if (recommendations.length === 0) {
    recommendations.push('System health is good. Continue monitoring.')
  }

  const digest: WeeklyDigest = {
    week_start: weekStartStr,
    week_end: weekEndStr,
    items_shipped: {
      count: shippedItems?.length || 0,
      items:
        shippedItems?.map((item) => ({
          id: item.id,
          description: item.description,
          resolved_at: item.resolved_at!,
        })) || [],
    },
    bugs: {
      resolved: bugsResolved?.length || 0,
      new_found: bugsFound?.length || 0,
      still_open: bugsOpen?.length || 0,
    },
    worker_health: {
      healthy: healthyCount,
      degraded: degradedCount,
      down: downCount,
      summary: workerSummary,
    },
    error_rate: {
      total_errors: totalErrors,
      avg_per_day: avgPerDay,
      trend,
    },
    recommendations,
  }

  return digest
}

/**
 * Save weekly digest to weekly_reviews table
 */
export async function saveWeeklyDigest(
  digest: WeeklyDigest
): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Update or insert weekly review with system health data
  const { error } = await supabase
    .from('weekly_reviews')
    .upsert(
      {
        week_start: digest.week_start,
        week_end: digest.week_end,
        system_health: {
          items_shipped: digest.items_shipped.count,
          bugs_resolved: digest.bugs.resolved,
          bugs_new: digest.bugs.new_found,
          bugs_open: digest.bugs.still_open,
          worker_health: digest.worker_health,
          error_rate: digest.error_rate,
          recommendations: digest.recommendations,
        },
        top_priorities: digest.recommendations.slice(0, 3), // Use recommendations as priorities
      },
      { onConflict: 'week_start' }
    )

  if (error) {
    console.error('Failed to save weekly digest:', error)
    return false
  }

  return true
}

/**
 * Get the most recent weekly digest
 */
export async function getLatestWeeklyDigest(): Promise<WeeklyDigest | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data } = await supabase
    .from('weekly_reviews')
    .select('*')
    .order('week_start', { ascending: false })
    .limit(1)
    .single()

  if (!data || !data.system_health) {
    return null
  }

  const health = data.system_health as StoredWeeklyDigestHealth

  return {
    week_start: data.week_start,
    week_end: data.week_end,
    items_shipped: {
      count: health.items_shipped || 0,
      items: [],
    },
    bugs: {
      resolved: health.bugs_resolved || 0,
      new_found: health.bugs_new || 0,
      still_open: health.bugs_open || 0,
    },
    worker_health: health.worker_health || {
      healthy: 0,
      degraded: 0,
      down: 0,
      summary: 'Unknown',
    },
    error_rate: health.error_rate || {
      total_errors: 0,
      avg_per_day: 0,
      trend: 'stable',
    },
    recommendations: health.recommendations || [],
  }
}

/**
 * Helper to get current week start/end (Monday to Sunday)
 */
export function getCurrentWeekRange(): { weekStart: Date; weekEnd: Date } {
  const now = new Date()
  const dayOfWeek = now.getDay() // 0 = Sunday, 1 = Monday, etc.
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek // Monday is start

  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() + diff)
  weekStart.setHours(0, 0, 0, 0)

  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  weekEnd.setHours(23, 59, 59, 999)

  return { weekStart, weekEnd }
}
