'use client'

import { useSyncExternalStore } from 'react'

const query = '(max-width: 767px)'

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => undefined
  const media = window.matchMedia(query)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function snapshot() {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

export function useMobileViewport() {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
