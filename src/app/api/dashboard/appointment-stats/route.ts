import { NextResponse } from 'next/server'
import { getAppointmentStats } from '@/lib/agent-stats'

export async function GET() {
  try {
    const stats = await getAppointmentStats(30)
    return NextResponse.json(stats)
  } catch (err: any) {
    console.error('[appointment-stats] Error:', err)
    return NextResponse.json(
      { error: 'Failed to fetch appointment stats' },
      { status: 500 }
    )
  }
}
