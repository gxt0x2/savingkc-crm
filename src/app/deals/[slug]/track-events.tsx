'use client'

// Legacy shim — pre-tracker components can keep calling trackEvent() directly.
// Use DealTracker for full session tracking; this is just for ad-hoc events.
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
  } catch { /* ignore */ }
}
