'use client'

import { useCallback, useSyncExternalStore } from 'react'

export type ThemePreference = 'dark' | 'light'

const STORAGE_KEY = 'crm-theme'
const EVENT_NAME = 'crm-theme-change'
const DEFAULT: ThemePreference = 'dark'

function readStored(): ThemePreference {
  if (typeof window === 'undefined') return DEFAULT
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v === 'light' ? 'light' : 'dark'
  } catch {
    return DEFAULT
  }
}

function subscribe(notify: () => void): () => void {
  function onChange() { notify() }
  window.addEventListener(EVENT_NAME, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT_NAME, onChange)
    window.removeEventListener('storage', onChange)
  }
}

function getServerSnapshot(): ThemePreference {
  return DEFAULT
}

/**
 * User-selected CRM theme. Persists to localStorage. Defaults to dark.
 *
 * TC mode has its own forced light theme (managed in AppShell); this hook
 * is only consulted on non-TC routes.
 */
export function useThemePreference(): {
  theme: ThemePreference
  setTheme: (t: ThemePreference) => void
  toggle: () => void
} {
  const theme = useSyncExternalStore(subscribe, readStored, getServerSnapshot)

  const setTheme = useCallback((next: ThemePreference) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore quota / privacy mode
    }
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }))
  }, [])

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  return { theme, setTheme, toggle }
}
