'use client'

import { useEffect } from 'react'
import { usePushNotifications } from '@/hooks/use-push-notifications'

export function PushManager() {
  const { isSupported, isSubscribed, subscribe, permission } = usePushNotifications()

  useEffect(() => {
    // Auto-prompt for push on first visit if not yet decided
    if (isSupported && !isSubscribed && permission === 'default') {
      // Small delay so the page loads first
      const timer = setTimeout(() => subscribe(), 3000)
      return () => clearTimeout(timer)
    }
  }, [isSupported, isSubscribed, permission, subscribe])

  return null // No UI — just registers in background
}
