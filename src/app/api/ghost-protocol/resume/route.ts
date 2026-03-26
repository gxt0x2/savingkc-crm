import { NextRequest, NextResponse } from 'next/server'
import { resumeGhostProtocol } from '@/lib/ghost-protocol'

/**
 * POST /api/ghost-protocol/resume
 * Resumes Ghost Protocol for a lead (GHP-06)
 */
export async function POST(req: NextRequest) {
  try {
    const { lead_id } = await req.json()

    if (!lead_id) {
      return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
    }

    const success = await resumeGhostProtocol(lead_id)

    if (!success) {
      return NextResponse.json({ error: 'Failed to resume ghost protocol' }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Ghost Protocol resumed' })
  } catch (error: any) {
    console.error('Resume ghost protocol error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
