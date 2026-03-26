import { NextRequest, NextResponse } from 'next/server'
import { generateAgentScorecard } from '@/lib/agent-scorecard'

/**
 * GET /api/agent/scorecard?agent_id={id}&period={daily|weekly}
 * Returns agent scorecard with KPI metrics, targets, and trends (AUD-02)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const agentId = searchParams.get('agent_id')
    const period = (searchParams.get('period') as 'daily' | 'weekly') || 'daily'

    if (!agentId) {
      return NextResponse.json({ error: 'agent_id required' }, { status: 400 })
    }

    const scorecard = await generateAgentScorecard(agentId, period)

    if (!scorecard) {
      return NextResponse.json({ error: 'Scorecard not found' }, { status: 404 })
    }

    return NextResponse.json(scorecard)
  } catch (error: any) {
    console.error('Scorecard generation error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
