import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'




interface SubscribeBody {
  subscription: {
    endpoint: string
    keys: {
      p256dh: string
      auth: string
    }
  }
  userId?: string
}

/**
 * POST /api/push/subscribe
 * Store a push subscription. Upserts by endpoint.
 */
export async function POST(request: NextRequest) {
  try {
    const body: SubscribeBody = await request.json()
    const { subscription, userId } = body

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json(
        { error: 'Invalid subscription: missing endpoint or keys' },
        { status: 400 }
      )
    }

    const userAgent = request.headers.get('user-agent') || null

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          endpoint: subscription.endpoint,
          keys_p256dh: subscription.keys.p256dh,
          keys_auth: subscription.keys.auth,
          user_id: userId || null,
          user_agent: userAgent,
          created_at: new Date().toISOString(),
        },
        {
          onConflict: 'endpoint',
        }
      )

    if (error) {
      console.error('[push/subscribe] Supabase upsert error:', error.message)
      return NextResponse.json(
        { error: 'Failed to save subscription' },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[push/subscribe] Error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/push/subscribe
 * Remove a subscription by endpoint.
 */
export async function DELETE(request: NextRequest) {
  try {
    const body: { endpoint: string } = await request.json()
    const { endpoint } = body

    if (!endpoint) {
      return NextResponse.json(
        { error: 'Missing endpoint' },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)

    if (error) {
      console.error('[push/subscribe] Supabase delete error:', error.message)
      return NextResponse.json(
        { error: 'Failed to delete subscription' },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[push/subscribe] Error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
