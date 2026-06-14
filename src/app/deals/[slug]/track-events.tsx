'use client'

export interface DealTrackingBrowserContext {
  slug: string
  session_id: string
  visitor_id: string
  buyer_id: string | null
  broadcast_id: string | null
  broadcast_recipient_id: string | null
  ref_code: string | null
  share_id: string | null
  page_path: string
  page_location: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
}

declare global {
  interface Window {
    __skcDealTracking?: DealTrackingBrowserContext
  }
}

function randomEventId(): string {
  try {
    if (crypto.randomUUID) return crypto.randomUUID()
  } catch { /* ignore */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function getStoredVisitorId(): string | null {
  try {
    return localStorage.getItem('skc_visitor_id')
  } catch {
    return null
  }
}

function getParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key)
  return value && value.trim() ? value.trim() : null
}

function getTrackingContext(slug: string, ref_code?: string | null): Partial<DealTrackingBrowserContext> {
  const params = new URLSearchParams(window.location.search)
  const existing = window.__skcDealTracking
  const urlRefCode = getParam(params, 's') || getParam(params, 'ref')

  return {
    slug,
    session_id: existing?.session_id,
    visitor_id: existing?.visitor_id || getStoredVisitorId() || undefined,
    buyer_id: existing?.buyer_id ?? getParam(params, 'buyer_id') ?? getParam(params, 'buyer'),
    broadcast_id: existing?.broadcast_id ?? getParam(params, 'broadcast_id') ?? getParam(params, 'broadcast'),
    broadcast_recipient_id:
      existing?.broadcast_recipient_id ??
      getParam(params, 'broadcast_recipient_id') ??
      getParam(params, 'recipient_id') ??
      getParam(params, 'recipient'),
    ref_code: ref_code ?? existing?.ref_code ?? urlRefCode,
    share_id: existing?.share_id ?? getParam(params, 'share_id') ?? getParam(params, 's'),
    page_path: window.location.pathname,
    page_location: window.location.href,
    utm_source: existing?.utm_source ?? getParam(params, 'utm_source'),
    utm_medium: existing?.utm_medium ?? getParam(params, 'utm_medium'),
    utm_campaign: existing?.utm_campaign ?? getParam(params, 'utm_campaign'),
    utm_term: existing?.utm_term ?? getParam(params, 'utm_term'),
    utm_content: existing?.utm_content ?? getParam(params, 'utm_content'),
  }
}

// Legacy shim — pre-tracker components can keep calling trackEvent() directly.
// The shim now attaches the active deal-page session/visitor context when present.
export function trackEvent(
  slug: string,
  event_type: string,
  metadata?: Record<string, unknown>,
  ref_code?: string | null
) {
  try {
    const context = getTrackingContext(slug, ref_code)
    const shareCode = typeof metadata?.share_code === 'string' ? metadata.share_code : null
    const payload = {
      event_id: randomEventId(),
      event_type,
      metadata: metadata || {},
      ...context,
      share_id: context.share_id || shareCode,
    }
    const body = JSON.stringify(payload)
    const blob = new Blob([body], { type: 'application/json' })
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`/api/deals/${slug}/events`, blob)
      return
    }
    fetch(`/api/deals/${slug}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch { /* ignore */ }
}
