/**
 * ARI CRM - Stage Timeout Checker API
 * Night 3: Pipeline Brain - WRK-11
 *
 * GET /api/stage/timeout
 * Returns array of leads exceeding their stage timeout thresholds
 *
 * POST /api/stage/timeout
 * Generates Ari briefing events for all timeout alerts
 */

import { NextResponse } from 'next/server'
import {
  checkStageTimeouts,
  checkContractDeadlines,
  generateTimeoutBriefingEvents,
} from '@/lib/stage-timeout'

export async function GET() {
  try {
    const stageAlerts = await checkStageTimeouts()
    const contractAlerts = await checkContractDeadlines()

    const allAlerts = [...stageAlerts, ...contractAlerts].sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2 }
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    })

    return NextResponse.json({
      count: allAlerts.length,
      alerts: allAlerts,
    })
  } catch (error) {
    console.error('Stage timeout check error:', error)
    return NextResponse.json(
      { error: 'Failed to check stage timeouts' },
      { status: 500 }
    )
  }
}

export async function POST() {
  try {
    const eventsCreated = await generateTimeoutBriefingEvents()

    return NextResponse.json({
      success: true,
      eventsCreated,
    })
  } catch (error) {
    console.error('Timeout briefing generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate timeout events' },
      { status: 500 }
    )
  }
}
