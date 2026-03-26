/**
 * ARI CRM - Agent Stats API
 * Night 3: ARI-04
 *
 * GET /api/agent/stats?agentId=...&date=... - Get stats for a date
 * GET /api/agent/stats?agentId=...&start=...&end=... - Get range
 * POST /api/agent/stats - Increment a stat
 */

import { NextResponse } from 'next/server'
import {
  getTodayStats,
  getStatsRange,
  aggregateStats,
  incrementStat,
  calculateRatios,
  generateCoachingInsight,
} from '@/lib/agent-stats'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')
    const date = searchParams.get('date')
    const start = searchParams.get('start')
    const end = searchParams.get('end')

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing agentId' },
        { status: 400 }
      )
    }

    // Single date
    if (date) {
      const stats = await getTodayStats(agentId)
      return NextResponse.json({ stats })
    }

    // Date range
    if (start && end) {
      const stats = await getStatsRange(agentId, start, end)
      const aggregate = await aggregateStats(agentId, start, end)
      const ratios = calculateRatios(aggregate)
      const insight = generateCoachingInsight(aggregate)

      return NextResponse.json({
        stats,
        aggregate,
        ratios,
        insight,
      })
    }

    // Default: today
    const stats = await getTodayStats(agentId)
    if (!stats) {
      return NextResponse.json({ error: 'No stats found' }, { status: 404 })
    }

    const ratios = calculateRatios(stats)
    const insight = generateCoachingInsight(stats)

    return NextResponse.json({ stats, ratios, insight })
  } catch (error) {
    console.error('Agent stats fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agent stats' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { agentId, statName, amount } = await request.json()

    if (!agentId || !statName) {
      return NextResponse.json(
        { error: 'Missing agentId or statName' },
        { status: 400 }
      )
    }

    const success = await incrementStat(agentId, statName, amount || 1)

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to increment stat' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Agent stats increment error:', error)
    return NextResponse.json(
      { error: 'Failed to update stat' },
      { status: 500 }
    )
  }
}
