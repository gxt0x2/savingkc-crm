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

function getRouteMode(pathname: string | null): AppMode | null {
  if (pathname?.startsWith('/dispo')) return 'dispositions'
  if (
    pathname?.startsWith('/ari') ||
    pathname?.startsWith('/opportunities') ||
    pathname?.startsWith('/leads') ||
    pathname?.startsWith('/dialer') ||
    pathname?.startsWith('/pipeline')
  ) {
    return 'acquisitions'
  }
  return null
}

export function useAppMode() {
  const pathname = usePathname()
  const [mode, setModeState] = useState<AppMode>(getStoredMode)
  const routeMode = getRouteMode(pathname)
  const effectiveMode = routeMode ?? mode

  useEffect(() => {
    if (routeMode) localStorage.setItem(STORAGE_KEY, routeMode)
  }, [routeMode])

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
    const next = effectiveMode === 'acquisitions' ? 'dispositions' : 'acquisitions'
    setMode(next)
  }, [effectiveMode, setMode])

  return { mode: effectiveMode, setMode, toggle }
}
