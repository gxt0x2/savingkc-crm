'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'

export type AppMode = 'acquisitions' | 'dispositions'

const STORAGE_KEY = 'savingkc-app-mode'

let listeners: Array<(mode: AppMode) => void> = []

function getStoredMode(): AppMode {
  if (typeof window === 'undefined') return 'acquisitions'
  return (localStorage.getItem(STORAGE_KEY) as AppMode) || 'acquisitions'
}

export function useAppMode() {
  const pathname = usePathname()
  const [mode, setModeState] = useState<AppMode>(getStoredMode)

  useEffect(() => {
    if (pathname?.startsWith('/dispo')) {
      setModeState('dispositions')
      localStorage.setItem(STORAGE_KEY, 'dispositions')
    } else if (
      pathname?.startsWith('/ari') ||
      pathname?.startsWith('/opportunities') ||
      pathname?.startsWith('/leads') ||
      pathname?.startsWith('/dialer') ||
      pathname?.startsWith('/pipeline')
    ) {
      setModeState('acquisitions')
      localStorage.setItem(STORAGE_KEY, 'acquisitions')
    }
  }, [pathname])

  useEffect(() => {
    const handler = (m: AppMode) => setModeState(m)
    listeners.push(handler)
    return () => {
      listeners = listeners.filter((l) => l !== handler)
    }
  }, [])

  const setMode = useCallback((newMode: AppMode) => {
    localStorage.setItem(STORAGE_KEY, newMode)
    setModeState(newMode)
    listeners.forEach((l) => l(newMode))
  }, [])

  const toggle = useCallback(() => {
    const next = mode === 'acquisitions' ? 'dispositions' : 'acquisitions'
    setMode(next)
  }, [mode, setMode])

  return { mode, setMode, toggle }
}
