import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

/**
 * GET /api/system-health/stats
 * Returns system health dashboard stats (FBK-05)
 */
export async function GET() {
  try {
    const health_errors: string[] = []

    // Feature completion (hardcoded for now - could be dynamic from a config table)
    const feature_completion = {
      current: 110,
      total: 132,
      percentage: Math.round((110 / 132) * 100),
    }

    // Open bugs count
    const { data: bugs, error: bugsError } = await supabase
      .from('feedback_submissions')
      .select('id')
      .eq('type', 'bug')
      .in('status', ['open', 'acknowledged', 'in_progress'])

    if (bugsError) {
      health_errors.push(`feedback_submissions health query failed: ${bugsError.message}`)
    }

    const open_bugs = bugsError ? null : bugs?.length || 0

    // Error rate trend (last 14 days)
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const { data: errors, error: errorsError } = await supabase
      .from('error_log')
      .select('created_at')
      .gte('created_at', fourteenDaysAgo.toISOString())

    if (errorsError) {
      health_errors.push(`error_log health query failed: ${errorsError.message}`)
    }

    // Group errors by date
    const errorsByDate: Record<string, number> = {}
    for (let i = 0; i < 14; i++) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      const dateStr = date.toISOString().split('T')[0]
      errorsByDate[dateStr] = 0
    }

    if (errors) {
      errors.forEach((err) => {
        const dateStr = err.created_at.split('T')[0]
        if (errorsByDate[dateStr] !== undefined) {
          errorsByDate[dateStr]++
        }
      })
    }

    const error_rate_trend = Object.entries(errorsByDate)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    // System workers status
    const { data: workers, error: workersError } = await supabase
      .from('system_workers')
      .select('name, status, last_run, failure_count_24h')

    if (workersError) {
      health_errors.push(`system_workers health query failed: ${workersError.message}`)
    }

    return NextResponse.json({
      feature_completion,
      open_bugs,
      error_rate_trend,
      health_errors,
      workers: (workers || []).map((w) => ({
        name: w.name,
        status: w.status,
        last_run: w.last_run,
        failure_count: w.failure_count_24h,
      })),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('System health stats error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
