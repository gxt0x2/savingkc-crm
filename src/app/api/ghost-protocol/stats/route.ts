import { NextResponse } from 'next/server'
import { getGhostProtocolStats } from '@/lib/ghost-protocol'

/**
 * GET /api/ghost-protocol/stats
 * Returns Ghost Protocol summary stats for dashboard (GHP-05)
 */
export async function GET() {
  try {
    const stats = await getGhostProtocolStats()
    return NextResponse.json(stats)
  } catch (error: any) {
    console.error('Ghost protocol stats error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
