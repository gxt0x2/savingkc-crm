import { NextResponse } from 'next/server'

import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { resolveMyDayDateRange } from '@/lib/my-day-range'
import { loadDialerDailyPerformance } from '@/lib/server/dialer-daily-performance'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }

export async function GET() {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const now = new Date()
  const today = resolveMyDayDateRange({ preset: 'today' }, now)
  try {
    const summary = await loadDialerDailyPerformance({
      actorEmail: actor.email,
      agentName: actor.name,
      from: today.from,
      to: today.to,
      now,
    })
    return NextResponse.json({ metrics: summary.rows[0], generatedAt: summary.generatedAt, timeZone: summary.timeZone }, { headers: NO_STORE })
  } catch (error) {
    console.error('[dialer/metrics/today] Daily performance unavailable', error)
    return NextResponse.json({ error: 'Today’s dialer metrics are unavailable' }, { status: 503, headers: NO_STORE })
  }
}
