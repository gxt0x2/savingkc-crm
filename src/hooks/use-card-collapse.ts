'use client'

import { useEffect, useState } from 'react'

/**
 * Per-card collapse state persisted to localStorage.
 * Returns [open, toggle].
 */
export function useCardCollapse(id: string, defaultOpen = true): [boolean, () => void] {
  const storageKey = `ck_collapse_${id}`
  const [open, setOpen] = useState(defaultOpen)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw != null) setOpen(raw === '1')
    } catch {
      /* ignore */
    }
    setReady(true)
  }, [storageKey])

  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem(storageKey, open ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [open, ready, storageKey])

  return [open, () => setOpen((v) => !v)]
}
