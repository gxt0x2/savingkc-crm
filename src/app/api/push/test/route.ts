import { NextRequest, NextResponse } from 'next/server'
import { sendPushToAgents } from '@/lib/push-notifications'

interface TestPushBody {
  title?: string
  body?: string
  url?: string
}

/**
 * POST /api/push/test
 * Send a test push notification to all subscribers.
 */
export async function POST(request: NextRequest) {
  try {
    let body: TestPushBody = {}

    try {
      body = await request.json()
    } catch {
      // Empty body is fine, we use defaults
    }

    const payload = {
      title: body.title || 'Test Push from Saving KC CRM',
      body: body.body || 'If you see this, push notifications are working!',
      url: body.url || '/',
      tag: 'test-notification',
    }

    const sentCount = await sendPushToAgents(payload)

    return NextResponse.json({
      ok: true,
      sent: sentCount,
      message: `Sent ${sentCount} notification(s)`,
    })
  } catch (err) {
    console.error('[push/test] Error:', err)
    return NextResponse.json(
      { error: 'Failed to send test notification' },
      { status: 500 }
    )
  }
}
