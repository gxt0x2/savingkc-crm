import { NextRequest, NextResponse } from 'next/server'
import { generateAccountabilityTimeline } from '@/lib/agent-scorecard'

/**
 * GET /api/agent/accountability-timeline?lead_id={id}
 * Returns expected vs actual timeline for a lead (AUD-05)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const leadId = searchParams.get('lead_id')

    if (!leadId) {
      return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
    }

    const timeline = await generateAccountabilityTimeline(leadId)

    return NextResponse.json({ lead_id: leadId, timeline })
  } catch (error: any) {
    console.error('Accountability timeline error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
