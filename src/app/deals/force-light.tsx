'use client'

import { useEffect } from 'react'

/**
 * Strips the root dark-theme classes (`dark` on <html>, `ck-dark` on <body>)
 * while the deals page is mounted, then restores them on unmount.
 * This prevents globals.css `.ck-dark` selectors from overriding light utilities.
 */
export default function ForceLight() {
  useEffect(() => {
    const html = document.documentElement
    const body = document.body

    // Remember original classes
    const hadDark = html.classList.contains('dark')
    const hadCkDark = body.classList.contains('ck-dark')
    const hadBgBackground = body.classList.contains('bg-background')
    const hadTextOnSurface = body.classList.contains('text-on-surface')

    // Strip dark theme classes
    html.classList.remove('dark')
    body.classList.remove('ck-dark', 'bg-background', 'text-on-surface')

    // Force light appearance
    html.style.colorScheme = 'light'
    body.style.background = '#f8f9fa'
    body.style.color = '#111827'

    return () => {
      // Restore original classes
      if (hadDark) html.classList.add('dark')
      if (hadCkDark) body.classList.add('ck-dark')
      if (hadBgBackground) body.classList.add('bg-background')
      if (hadTextOnSurface) body.classList.add('text-on-surface')

      html.style.colorScheme = ''
      body.style.background = ''
      body.style.color = ''
    }
  }, [])

  return null
}
