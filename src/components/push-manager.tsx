'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { usePushNotifications } from '@/hooks/use-push-notifications'

// Public marketing routes that should never trigger the push permission
// prompt — these are for unauthenticated visitors (Google Ads landers,
// legal pages, etc.). /sell is a cold-prospect lander; asking to "Show
// notifications" tanks the trust signal.
const PUBLIC_ROUTE_PREFIXES = ['/ppc', '/login', '/privacy', '/terms']

export function PushManager() {
  const pathname = usePathname()
  const isPublicRoute = !!pathname && PUBLIC_ROUTE_PREFIXES.some((p) => pathname.startsWith(p))
  const { isSupported, isSubscribed, subscribe, permission, isConfigured } = usePushNotifications()

  useEffect(() => {
    if (isPublicRoute || !isConfigured) return
    if (isSupported && !isSubscribed && permission === 'default') {
      const timer = setTimeout(() => {
        void subscribe().catch((error) => {
          console.error('[push] Subscription failed:', error)
        })
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [isConfigured, isPublicRoute, isSupported, isSubscribed, permission, subscribe])

  return null
}
