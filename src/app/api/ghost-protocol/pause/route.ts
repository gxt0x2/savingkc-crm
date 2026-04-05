import { NextRequest, NextResponse } from 'next/server'
import { pauseGhostProtocol } from '@/lib/ghost-protocol-pipeline'

/**
 * POST /api/ghost-protocol/pause
 * Pauses Ghost Protocol for a lead (GHP-06)
 */
export async function POST(req: NextRequest) {
  try {
    const { lead_id, reason } = await req.json()

    if (!lead_id || !reason) {
      return NextResponse.json({ error: 'lead_id and reason required' }, { status: 400 })
    }

    const success = await pauseGhostProtocol(lead_id, reason)

    if (!success) {
      return NextResponse.json({ error: 'Failed to pause ghost protocol' }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Ghost Protocol paused' })
  } catch (error: any) {
    console.error('Pause ghost protocol error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
