// ROL-04: System Worker Health Monitoring API
// Night 4 Phase 4: Check and report on system worker status

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getAllWorkers,
  getWorkerHealthSummary,
  recordWorkerRun,
  resetFailureCounts,
  alertOnWorkerIssues,
} from '@/lib/system-health'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') || 'summary'

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    switch (action) {
      case 'summary': {
        const summary = await getWorkerHealthSummary(supabase)
        return NextResponse.json({
          success: true,
          summary,
        })
      }

      case 'all': {
        const workers = await getAllWorkers(supabase)
        return NextResponse.json({
          success: true,
          count: workers.length,
          workers,
        })
      }

      case 'reset-failures': {
        const resetCount = await resetFailureCounts(supabase)
        return NextResponse.json({
          success: true,
          message: `Reset failure counts for ${resetCount} workers`,
          resetCount,
        })
      }

      case 'check-and-alert': {
        const alertsCreated = await alertOnWorkerIssues(supabase)
        const summary = await getWorkerHealthSummary(supabase)
        return NextResponse.json({
          success: true,
          alertsCreated,
          summary,
          message: `Created ${alertsCreated} alerts for ${summary.degraded + summary.down} problematic workers`,
        })
      }

      default: {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid action. Use: summary, all, reset-failures, or check-and-alert',
          },
          { status: 400 }
        )
      }
    }
  } catch (error) {
    console.error('System health check error:', error)
    return NextResponse.json(
      {
        success: false,
        error: String(error),
      },
      { status: 500 }
    )
  }
}

// POST endpoint to record worker runs
export async function POST(request: NextRequest) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const body = await request.json()
    const { workerName, success, error } = body

    if (!workerName) {
      return NextResponse.json(
        { success: false, error: 'workerName is required' },
        { status: 400 }
      )
    }

    await recordWorkerRun(supabase, workerName, success === true, error)

    return NextResponse.json({
      success: true,
      message: `Recorded ${success ? 'successful' : 'failed'} run for ${workerName}`,
      workerName,
      status: success ? 'success' : 'failure',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Record worker run error:', error)
    return NextResponse.json(
      {
        success: false,
        error: String(error),
      },
      { status: 500 }
    )
  }
}
