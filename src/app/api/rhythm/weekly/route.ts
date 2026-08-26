/**
 * ARI CRM - Weekly Review API
 * Night 3: RHY-03
 * Night 6: FBK-09 - Added weekly system health digest
 *
 * GET /api/rhythm/weekly?agentId=...&weekStart=... - Get weekly review data
 * POST /api/rhythm/weekly - Save weekly review to database
 * POST /api/rhythm/weekly/digest - Generate and save weekly health digest
 */

import { NextResponse } from 'next/server'
import { getWeeklyReview, saveWeeklyReview } from '@/lib/operating-rhythm'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId') || 'casey'
    const weekStart = searchParams.get('weekStart') || undefined

    const review = await getWeeklyReview(agentId, weekStart)

    return NextResponse.json(review)
  } catch (error) {
    console.error('Weekly review error:', error)
    return NextResponse.json(
      { error: 'Failed to generate weekly review' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const review = await request.json()

    const success = await saveWeeklyReview(review)

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to save weekly review' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Weekly review save error:', error)
    return NextResponse.json(
      { error: 'Failed to save weekly review' },
      { status: 500 }
    )
  }
}
