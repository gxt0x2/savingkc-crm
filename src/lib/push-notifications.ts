import webpush from 'web-push'
import { supabase } from '@/lib/supabase-lazy'


// Configure VAPID keys (graceful if not set yet)
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ''
let pushConfigured = false

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(
      'mailto:admin@savingkc.com',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    )
    pushConfigured = true
  } catch (e) {
    console.error('[push] Failed to configure VAPID:', e)
  }
}



export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

interface PushSubscriptionRow {
  id: string
  user_id: string | null
  endpoint: string
  keys_p256dh: string
  keys_auth: string
  created_at: string
  user_agent: string | null
}

/**
 * Send a push notification to all subscribed agents.
 * Returns the number of notifications successfully sent.
 */
export async function sendPushToAgents(payload: PushPayload): Promise<number> {
  if (!pushConfigured) return 0

  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('*')

  if (error) {
    console.error('[push] Failed to fetch subscriptions:', error.message)
    return 0
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.log('[push] No push subscriptions found')
    return 0
  }

  return sendToSubscriptions(subscriptions as PushSubscriptionRow[], payload)
}

/**
 * Send a push notification to a specific user by user ID.
 * Returns the number of notifications successfully sent.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured) return 0

  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId)

  if (error) {
    console.error(`[push] Failed to fetch subscriptions for user ${userId}:`, error.message)
    return 0
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.log(`[push] No push subscriptions found for user ${userId}`)
    return 0
  }

  return sendToSubscriptions(subscriptions as PushSubscriptionRow[], payload)
}

/**
 * Internal: send push to a list of subscription rows.
 * Cleans up expired (410 Gone) subscriptions automatically.
 */
async function sendToSubscriptions(
  subscriptions: PushSubscriptionRow[],
  payload: PushPayload
): Promise<number> {
  const notificationPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/',
    tag: payload.tag || 'savingkc-notification',
    icon: '/logo.png',
  })

  let sentCount = 0

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const pushSubscription: webpush.PushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.keys_p256dh,
          auth: sub.keys_auth,
        },
      }

      try {
        await webpush.sendNotification(pushSubscription, notificationPayload)
        sentCount++
      } catch (err: unknown) {
        const webPushError = err as { statusCode?: number; message?: string }
        if (webPushError.statusCode === 410) {
          // Subscription expired or unsubscribed - clean it up
          console.log(`[push] Removing expired subscription: ${sub.endpoint.slice(0, 60)}...`)
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('id', sub.id)
        } else {
          console.error(
            `[push] Failed to send to ${sub.endpoint.slice(0, 60)}...:`,
            webPushError.statusCode,
            webPushError.message
          )
        }
      }
    })
  )

  console.log(`[push] Sent ${sentCount}/${subscriptions.length} notifications`)
  return sentCount
}
