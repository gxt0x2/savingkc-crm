/**
 * ARI CRM - Mojo Dialer Sync Worker
 * Night 6: INT-02
 *
 * Polls Mojo data every 15 minutes during office hours (8am-5pm CT)
 * Triggered by: Cron job OR EOD submission
 *
 * POST /api/workers/mojo-sync - Trigger sync
 * GET /api/workers/mojo-sync - Get sync status
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Check if current time is within office hours (8am-5pm Central Time)
 */
function isOfficeHours(): boolean {
  const now = new Date()

  // Convert to Central Time
  const centralTime = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/Chicago' })
  )

  const hour = centralTime.getHours()
  const dayOfWeek = centralTime.getDay() // 0 = Sunday, 6 = Saturday

  // Monday-Friday, 8am-5pm
  return dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 8 && hour < 17
}

/**
 * Sync Mojo data to agent_daily_stats
 */
async function syncMojoData(): Promise<{
  success: boolean
  calls: number
  conversations: number
  error?: string
}> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Read most recent mojo file
    const memoryDir =
      process.env.HOME + '/.openclaw/workspace/memory' ||
      '/Users/ernestdodson/.openclaw/workspace/memory'

    const fs = await import('fs')
    const path = await import('path')

    let mojoData: any = null
    try {
      const files = fs
        .readdirSync(memoryDir)
        .filter((f) => f.startsWith('mojo-calls-') && f.endsWith('.json'))
        .sort()
        .reverse()

      if (files.length > 0) {
        const filePath = path.join(memoryDir, files[0])
        const raw = fs.readFileSync(filePath, 'utf-8')
        mojoData = JSON.parse(raw)
      }
    } catch (err) {
      // Mojo file not found - not an error, just means no data yet
      console.log('No Mojo data file found')
    }

    if (!mojoData) {
      return {
        success: true,
        calls: 0,
        conversations: 0,
        error: 'No Mojo data available',
      }
    }

    const results = mojoData.results || []
    const date = mojoData.date || new Date().toISOString().split('T')[0]

    const totalCalls = mojoData.total_recordings ?? results.length
    const meaningfulCalls =
      mojoData.meaningful_calls ??
      results.filter(
        (r: any) =>
          r.analysis?.motivation_level && r.analysis.motivation_level >= 3
      ).length

    const motivationScores = results
      .map((r: any) => r.analysis?.motivation_level)
      .filter((s: any): s is number => typeof s === 'number')

    const avgMotivation =
      motivationScores.length > 0
        ? Math.round(
            (motivationScores.reduce((a: number, b: number) => a + b, 0) /
              motivationScores.length) *
              10
          ) / 10
        : 0

    // Upsert to agent_daily_stats
    const { error } = await supabase.from('agent_daily_stats').upsert(
      {
        agent_id: 'casey', // Default agent
        date,
        calls_made: totalCalls,
        meaningful_conversations: meaningfulCalls,
        metadata: {
          avg_motivation: avgMotivation,
          last_sync: new Date().toISOString(),
          source: 'mojo_dialer',
        },
      },
      { onConflict: 'agent_id,date' }
    )

    if (error) {
      console.error('Failed to save Mojo stats:', error)
      return {
        success: false,
        calls: totalCalls,
        conversations: meaningfulCalls,
        error: error.message,
      }
    }

    // Update system_workers table
    await supabase
      .from('system_workers')
      .update({
        last_run: new Date().toISOString(),
        last_success: new Date().toISOString(),
        status: 'healthy',
      })
      .eq('name', 'Mojo Sync')

    return {
      success: true,
      calls: totalCalls,
      conversations: meaningfulCalls,
    }
  } catch (error) {
    console.error('Mojo sync error:', error)
    return {
      success: false,
      calls: 0,
      conversations: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const force = searchParams.get('force') === 'true'

    // Check office hours unless forced
    if (!force && !isOfficeHours()) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'Outside office hours (8am-5pm CT, Mon-Fri)',
      })
    }

    const result = await syncMojoData()

    return NextResponse.json(result)
  } catch (error) {
    console.error('Mojo sync endpoint error:', error)
    return NextResponse.json(
      { success: false, error: 'Sync failed' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: worker } = await supabase
      .from('system_workers')
      .select('*')
      .eq('name', 'Mojo Sync')
      .single()

    const officeHours = isOfficeHours()

    return NextResponse.json({
      worker_status: worker?.status || 'unknown',
      last_run: worker?.last_run || null,
      last_success: worker?.last_success || null,
      office_hours: officeHours,
      office_hours_info: '8am-5pm CT, Monday-Friday',
      polling_enabled: officeHours,
      manual_trigger: 'POST /api/workers/mojo-sync?force=true',
    })
  } catch (error) {
    console.error('Mojo sync status error:', error)
    return NextResponse.json(
      { error: 'Status check failed' },
      { status: 500 }
    )
  }
}
