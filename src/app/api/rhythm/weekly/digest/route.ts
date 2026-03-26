/**
 * ARI CRM - Weekly System Health Digest API
 * Night 6: FBK-09
 *
 * POST /api/rhythm/weekly/digest - Generate and save weekly health digest for current week
 * GET /api/rhythm/weekly/digest - Get latest weekly digest
 */

import { NextResponse } from 'next/server'
import {
  generateWeeklyDigest,
  saveWeeklyDigest,
  getLatestWeeklyDigest,
  getCurrentWeekRange,
} from '@/lib/weekly-digest'
import { createBriefingEvent } from '@/lib/ari-briefing'

export async function POST() {
  try {
    const { weekStart, weekEnd } = getCurrentWeekRange()

    const digest = await generateWeeklyDigest(weekStart, weekEnd)

    if (!digest) {
      return NextResponse.json(
        { error: 'Failed to generate weekly digest' },
        { status: 500 }
      )
    }

    const saved = await saveWeeklyDigest(digest)

    if (!saved) {
      return NextResponse.json(
        { error: 'Failed to save weekly digest' },
        { status: 500 }
      )
    }

    // Create Ari briefing event for Monday morning
    const now = new Date()
    if (now.getDay() === 1) {
      // Monday
      await createBriefingEvent({
        event_type: 'eod_submission',
        priority: 'medium',
        title: 'Weekly Review Ready',
        description: `Week of ${weekStart.toLocaleDateString()}: ${digest.items_shipped.count} items shipped, ${digest.bugs.resolved} bugs resolved. ${digest.recommendations[0] || 'All systems healthy.'}`,
        action_url: '/settings?tab=health',
        metadata: { digest },
      })
    }

    return NextResponse.json({ success: true, digest })
  } catch (error) {
    console.error('Weekly digest generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate weekly digest' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const digest = await getLatestWeeklyDigest()

    if (!digest) {
      return NextResponse.json(
        { error: 'No weekly digest found' },
        { status: 404 }
      )
    }

    return NextResponse.json(digest)
  } catch (error) {
    console.error('Weekly digest fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch weekly digest' },
      { status: 500 }
    )
  }
}
