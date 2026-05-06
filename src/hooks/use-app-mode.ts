'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

export type AppMode = 'acquisitions' | 'dispositions' | 'tc'

const STORAGE_KEY = 'savingkc-app-mode'

let memoryMode: AppMode = 'acquisitions'
let listeners: Array<() => void> = []

function normalizeMode(value: string | null): AppMode | null {
  return value === 'acquisitions' || value === 'dispositions' || value === 'tc' ? value : null
}

function getRouteMode(pathname: string | null, department?: string | null, portal?: string | null): AppMode | null {
  if (pathname?.startsWith('/dispo/tc')) return 'tc'
  if (pathname?.startsWith('/dispo/contacts') && portal === 'tc') return 'tc'
  if (pathname?.startsWith('/settings') && portal === 'tc') return 'tc'
  if (pathname?.startsWith('/dispo')) return 'dispositions'
  if (pathname?.startsWith('/calendar')) {
    const calendarMode = normalizeMode(department ?? null)
    if (calendarMode) return calendarMode
  }
  if (
    pathname?.startsWith('/ari') ||
    pathname?.startsWith('/opportunities') ||
    pathname?.startsWith('/leads') ||
    pathname?.startsWith('/dialer') ||
    pathname?.startsWith('/dashboard') ||
    pathname?.startsWith('/pipeline') ||
    pathname?.startsWith('/checklist')
  ) {
    return 'acquisitions'
  }
  return null
}

function getStoredMode(): AppMode {
  if (typeof window === 'undefined') return memoryMode
  return normalizeMode(localStorage.getItem(STORAGE_KEY)) ?? memoryMode
}

function subscribe(listener: () => void) {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

function persistMode(newMode: AppMode) {
  memoryMode = newMode
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, newMode)
  }
  listeners.forEach((listener) => listener())
}

export function useAppMode() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const routeMode = getRouteMode(pathname, searchParams.get('department'), searchParams.get('portal'))
  const storedMode = useSyncExternalStore(subscribe, getStoredMode, () => memoryMode)
  const mode = routeMode ?? storedMode

  useEffect(() => {
    if (routeMode && routeMode !== getStoredMode()) persistMode(routeMode)
  }, [routeMode])

  const setMode = useCallback((newMode: AppMode) => {
    persistMode(newMode)
  }, [])

  const toggle = useCallback(() => {
    const next = mode === 'acquisitions' ? 'dispositions' : 'acquisitions'
    setMode(next)
  }, [mode, setMode])

  return { mode, setMode, toggle }
}
