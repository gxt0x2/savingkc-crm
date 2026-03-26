import { NextRequest, NextResponse } from 'next/server'
import { cancelGhostProtocol } from '@/lib/ghost-protocol'

/**
 * POST /api/ghost-protocol/cancel
 * Cancels Ghost Protocol for a lead (GHP-06)
 */
export async function POST(req: NextRequest) {
  try {
    const { lead_id, reason } = await req.json()

    if (!lead_id || !reason) {
      return NextResponse.json({ error: 'lead_id and reason required' }, { status: 400 })
    }

    const success = await cancelGhostProtocol(lead_id, reason)

    if (!success) {
      return NextResponse.json({ error: 'Failed to cancel ghost protocol' }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Ghost Protocol cancelled' })
  } catch (error: any) {
    console.error('Cancel ghost protocol error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
