'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

/**
 * Convert a base64 URL-safe string to a Uint8Array for use with pushManager.subscribe()
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  if (!base64String || typeof base64String !== 'string') {
    throw new Error('Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY')
  }
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false)
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const autoSubscribeAttempted = useRef(false)
  const hasWarnedMissingKey = useRef(false)
  const hasVapidKey = VAPID_PUBLIC_KEY.trim().length > 0

  // Check support and current state on mount
  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window

    setIsSupported(supported)

    if (!supported) return

    setPermission(Notification.permission)

    // Register the service worker
    navigator.serviceWorker
      .register('/sw.js')
      .then(async (registration) => {
        // Check if already subscribed
        const existing = await registration.pushManager.getSubscription()
        setIsSubscribed(!!existing)
      })
      .catch((err) => {
        console.error('[push] Service worker registration failed:', err)
      })
  }, [])

  const subscribeImpl = useCallback(async () => {
    if (!isSupported) return
    if (!hasVapidKey) return

    // Request permission if not already granted
    const perm = await Notification.requestPermission()
    setPermission(perm)

    if (perm !== 'granted') {
      console.warn('[push] Notification permission denied')
      return
    }

    const registration = await navigator.serviceWorker.ready

    // Subscribe to push
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    } as PushSubscriptionOptionsInit)

    // Send subscription to server
    const subscriptionJSON = subscription.toJSON()
    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: {
          endpoint: subscriptionJSON.endpoint,
          keys: {
            p256dh: subscriptionJSON.keys?.p256dh,
            auth: subscriptionJSON.keys?.auth,
          },
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to save subscription: ${response.status}`)
    }

    setIsSubscribed(true)
    console.log('[push] Subscribed successfully')
  }, [hasVapidKey, isSupported])

  // Auto-subscribe if permission is already granted. A preview without a VAPID
  // key is a supported, intentionally unconfigured state—not an application error.
  useEffect(() => {
    if (!hasVapidKey) {
      if (process.env.NODE_ENV === 'development' && !hasWarnedMissingKey.current) {
        hasWarnedMissingKey.current = true
        console.warn('[push] Auto-subscribe skipped: NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set')
      }
      return
    }

    if (isSupported && permission === 'granted' && !isSubscribed && !autoSubscribeAttempted.current) {
      autoSubscribeAttempted.current = true
      subscribeImpl().catch((err) => {
        console.error('[push] Auto-subscribe failed:', err)
      })
    }
  }, [hasVapidKey, isSupported, permission, isSubscribed, subscribeImpl])

  const subscribe = useCallback(async () => {
    await subscribeImpl()
  }, [subscribeImpl])

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return

    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()

    if (subscription) {
      const endpoint = subscription.endpoint

      // Unsubscribe from browser
      await subscription.unsubscribe()

      // Remove from server
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      })
    }

    setIsSubscribed(false)
    console.log('[push] Unsubscribed successfully')
  }, [isSupported])

  return {
    isSupported,
    isSubscribed,
    subscribe,
    unsubscribe,
    permission,
    isConfigured: hasVapidKey,
  }
}
