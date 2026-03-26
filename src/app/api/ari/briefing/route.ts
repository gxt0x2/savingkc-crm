/**
 * ARI CRM - Ari Briefing API
 * Night 3: Proactive Intelligence
 *
 * GET /api/ari/briefing - Fetch recent briefing events
 * POST /api/ari/briefing/mark-read - Mark event as read
 * POST /api/ari/briefing/dismiss - Dismiss event
 */

import { NextResponse } from 'next/server'
import {
  getBriefingEvents,
  markBriefingEventRead,
  dismissBriefingEvent,
} from '@/lib/ari-briefing'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '10')
    const includeRead = searchParams.get('includeRead') === 'true'
    const includeDismissed = searchParams.get('includeDismissed') === 'true'

    const events = await getBriefingEvents({
      limit,
      includeRead,
      includeDismissed,
    })

    return NextResponse.json({ events, count: events.length })
  } catch (error) {
    console.error('Briefing fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch briefing events' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { action, eventId } = await request.json()

    if (!eventId) {
      return NextResponse.json(
        { error: 'Missing eventId' },
        { status: 400 }
      )
    }

    if (action === 'mark-read') {
      const success = await markBriefingEventRead(eventId)
      return NextResponse.json({ success })
    }

    if (action === 'dismiss') {
      const success = await dismissBriefingEvent(eventId)
      return NextResponse.json({ success })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Briefing action error:', error)
    return NextResponse.json(
      { error: 'Failed to process action' },
      { status: 500 }
    )
  }
}
