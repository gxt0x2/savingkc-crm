'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { loadDialerTodayMetrics, type DialerTodayMetrics } from '@/lib/dialer-session-client'

/**
 * Refreshes the acquisition HUD at meaningful workflow boundaries. This is
 * deliberately event-driven: no background polling and no invented local
 * totals that can drift from the server-owned attempts and sessions.
 */
export function useDialerTodayMetrics(disabled = false) {
  const [metrics, setMetrics] = useState<DialerTodayMetrics | null>(null)
  const requestVersion = useRef(0)

  const refresh = useCallback(async () => {
    if (disabled) return
    const version = ++requestVersion.current
    try {
      const result = await loadDialerTodayMetrics()
      if (version === requestVersion.current) setMetrics(result)
    } catch (error) {
      console.error('[Dialer] Could not load today metrics', error)
      if (version === requestVersion.current) setMetrics(null)
    }
  }, [disabled])

  useEffect(() => {
    const onWorkflowChange = () => { void refresh() }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('heir-attempt-logged', onWorkflowChange)
    window.addEventListener('crm:disposition-logged', onWorkflowChange)
    window.addEventListener('dialer-session-state', onWorkflowChange)
    window.addEventListener('focus', onWorkflowChange)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const initialLoad = window.setTimeout(onWorkflowChange, 0)
    return () => {
      requestVersion.current += 1
      window.clearTimeout(initialLoad)
      window.removeEventListener('heir-attempt-logged', onWorkflowChange)
      window.removeEventListener('crm:disposition-logged', onWorkflowChange)
      window.removeEventListener('dialer-session-state', onWorkflowChange)
      window.removeEventListener('focus', onWorkflowChange)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refresh])

  return metrics
}
