// RCY-01: Dead Lead Recycler API Endpoint
// Night 4 Phase 3: Cron-callable endpoint for lead recycling

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  autoRecycleLeads,
  getDeadLeadStats,
  findRecycleCandidates,
} from '@/lib/dead-lead-recycler'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') || 'stats'
  const threshold = parseInt(searchParams.get('threshold') || '90') as 90 | 180
  const autoRecycle = searchParams.get('autoRecycle') === 'true'

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    switch (action) {
      case 'stats': {
        const stats = await getDeadLeadStats(supabase)
        return NextResponse.json({
          success: true,
          stats,
        })
      }

      case 'find': {
        const candidates = await findRecycleCandidates(supabase, threshold)
        return NextResponse.json({
          success: true,
          threshold,
          count: candidates.length,
          candidates,
        })
      }

      case 'recycle': {
        const result = await autoRecycleLeads(supabase, threshold, autoRecycle)
        return NextResponse.json({
          success: true,
          threshold,
          autoRecycle,
          ...result,
          message: autoRecycle
            ? `Recycled ${result.recycled} of ${result.candidates} candidates, created ${result.alerted} alerts`
            : `Found ${result.candidates} candidates, created ${result.alerted} alerts (no auto-recycle)`,
        })
      }

      default: {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid action. Use: stats, find, or recycle',
          },
          { status: 400 }
        )
      }
    }
  } catch (error) {
    console.error('Dead lead recycler error:', error)
    return NextResponse.json(
      {
        success: false,
        error: String(error),
      },
      { status: 500 }
    )
  }
}

// POST endpoint for cron jobs
export async function POST(request: NextRequest) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const body = await request.json()
    const threshold = (body.threshold || 90) as 90 | 180
    const autoRecycle = body.autoRecycle === true

    const result = await autoRecycleLeads(supabase, threshold, autoRecycle)

    return NextResponse.json({
      success: true,
      threshold,
      autoRecycle,
      ...result,
      message: autoRecycle
        ? `Recycled ${result.recycled} of ${result.candidates} candidates`
        : `Created ${result.alerted} alerts for ${result.candidates} candidates`,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Dead lead recycler error:', error)
    return NextResponse.json(
      {
        success: false,
        error: String(error),
      },
      { status: 500 }
    )
  }
}
