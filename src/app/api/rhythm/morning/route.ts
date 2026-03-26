/**
 * ARI CRM - Morning Briefing API
 * Night 3: RHY-01
 *
 * GET /api/rhythm/morning?agentId=... - Get morning briefing data
 */

import { NextResponse } from 'next/server'
import { getMorningBriefing } from '@/lib/operating-rhythm'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId') || 'casey'

    const briefing = await getMorningBriefing(agentId)

    return NextResponse.json(briefing)
  } catch (error) {
    console.error('Morning briefing error:', error)
    return NextResponse.json(
      { error: 'Failed to generate morning briefing' },
      { status: 500 }
    )
  }
}
