'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'

export type AppMode = 'acquisitions' | 'dispositions' | 'tc'

const STORAGE_KEY = 'savingkc-app-mode'

let listeners: Array<(mode: AppMode) => void> = []

function getStoredMode(): AppMode {
  if (typeof window === 'undefined') return 'acquisitions'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'dispositions') return 'dispositions'
  return 'acquisitions'
}

function getRouteMode(pathname: string | null): AppMode | null {
  if (pathname?.startsWith('/dispo/tc')) return 'tc'
  if (pathname?.startsWith('/dispo')) return 'dispositions'
  if (
    pathname?.startsWith('/ari') ||
    pathname?.startsWith('/opportunities') ||
    pathname?.startsWith('/leads') ||
    pathname?.startsWith('/dialer') ||
    pathname?.startsWith('/pipeline') ||
    pathname?.startsWith('/dashboard') ||
    pathname?.startsWith('/checklist')
  ) {
    return 'acquisitions'
  }
  return null
}

export function useAppMode() {
  const pathname = usePathname()
  const [mode, setModeState] = useState<AppMode>(getStoredMode)
  const routeMode = getRouteMode(pathname)
  const storedMode = mode === 'tc' && routeMode !== 'tc' ? getStoredMode() : mode
  const effectiveMode = routeMode ?? storedMode

  useEffect(() => {
    if (routeMode && routeMode !== 'tc') localStorage.setItem(STORAGE_KEY, routeMode)
  }, [routeMode])

  useEffect(() => {
    const handler = (m: AppMode) => setModeState(m)
    listeners.push(handler)
    return () => {
      listeners = listeners.filter((l) => l !== handler)
    }
  }, [])

  const setMode = useCallback((newMode: AppMode) => {
    if (newMode !== 'tc') localStorage.setItem(STORAGE_KEY, newMode)
    setModeState(newMode)
    listeners.forEach((l) => l(newMode))
  }, [])

  const toggle = useCallback(() => {
    const next = effectiveMode === 'acquisitions' ? 'dispositions' : 'acquisitions'
    setMode(next)
  }, [effectiveMode, setMode])

  return { mode: effectiveMode, setMode, toggle }
}
