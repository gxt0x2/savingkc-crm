'use client'

import { useEffect } from 'react'

export function trackEvent(
  slug: string,
  event_type: string,
  metadata?: Record<string, unknown>,
  ref_code?: string | null
) {
  try {
    fetch(`/api/deals/${slug}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type, metadata, ref_code }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}

/* Client component that fires page_view + share_visit on mount */
export function PageViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    // Check for share ref param (e.g., ?s=abc123)
    const params = new URLSearchParams(window.location.search)
    const refCode = params.get('s') || params.get('ref')

    trackEvent(slug, 'page_view', { url: window.location.pathname }, refCode)
    if (refCode) {
      trackEvent(slug, 'share_visit', { ref_code: refCode }, refCode)
    }
  }, [slug])

  return null
}
