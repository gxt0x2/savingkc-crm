'use client'

import { useState, useEffect, useCallback } from 'react'

export type AppMode = 'acquisitions' | 'dispositions'

const STORAGE_KEY = 'savingkc-app-mode'

let listeners: Array<(mode: AppMode) => void> = []

function getStoredMode(): AppMode {
  if (typeof window === 'undefined') return 'acquisitions'
  return (localStorage.getItem(STORAGE_KEY) as AppMode) || 'acquisitions'
}

export function useAppMode() {
  const [mode, setModeState] = useState<AppMode>(getStoredMode)

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
