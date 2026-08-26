'use client'

import { useCallback, useSyncExternalStore } from 'react'

const COLLAPSE_CHANGE_EVENT = 'ck-collapse-change'

function readCollapseState(storageKey: string, defaultOpen: boolean): boolean {
  try {
    const raw = localStorage.getItem(storageKey)
    return raw == null ? defaultOpen : raw === '1'
  } catch {
    return defaultOpen
  }
}

/**
 * Per-card collapse state persisted to localStorage.
 * Returns [open, toggle].
 */
export function useCardCollapse(id: string, defaultOpen = true): [boolean, () => void] {
  const storageKey = `ck_collapse_${id}`
  const subscribe = useCallback((onStoreChange: () => void) => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) onStoreChange()
    }
    const handleLocalChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === storageKey) onStoreChange()
    }
    window.addEventListener('storage', handleStorage)
    window.addEventListener(COLLAPSE_CHANGE_EVENT, handleLocalChange)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(COLLAPSE_CHANGE_EVENT, handleLocalChange)
    }
  }, [storageKey])
  const getSnapshot = useCallback(
    () => readCollapseState(storageKey, defaultOpen),
    [defaultOpen, storageKey],
  )
  const getServerSnapshot = useCallback(() => defaultOpen, [defaultOpen])
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const toggle = useCallback(() => {
    try {
      localStorage.setItem(storageKey, open ? '0' : '1')
      window.dispatchEvent(new CustomEvent(COLLAPSE_CHANGE_EVENT, { detail: storageKey }))
    } catch {
      /* Keep the rendered default when storage is unavailable. */
    }
  }, [open, storageKey])

  return [open, toggle]
}
