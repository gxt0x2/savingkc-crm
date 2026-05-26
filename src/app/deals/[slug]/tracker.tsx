'use client'

import { useEffect, useRef } from 'react'

const HEARTBEAT_MS = 10_000           // send session heartbeat every 10s
const ACTIVITY_THRESHOLD_MS = 30_000  // user idle after 30s no input
const SECTION_DWELL_MS = 1_000        // section must be in view this long

function getOrCreateId(key: string, store: Storage): string {
  let id = store.getItem(key)
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)
    store.setItem(key, id)
  }
  return id
}

function detectDevice(): { device_type: string; browser: string; os: string } {
  const ua = navigator.userAgent
  const device_type =
    /iPad|Tablet/i.test(ua) ? 'tablet' :
    /Mobi|Android|iPhone/i.test(ua) ? 'mobile' :
    'desktop'
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Safari\//.test(ua) ? 'Safari' :
    'Other'
  const os =
    /Windows NT/i.test(ua) ? 'Windows' :
    /Mac OS X/i.test(ua) ? 'macOS' :
    /Android/i.test(ua) ? 'Android' :
    /iPhone|iPad|iOS/i.test(ua) ? 'iOS' :
    /Linux/i.test(ua) ? 'Linux' :
    'Other'
  return { device_type, browser, os }
}

function randomEventId(): string {
  try {
    if (crypto.randomUUID) return crypto.randomUUID()
  } catch { /* ignore */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function getParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key)
  return value && value.trim() ? value.trim() : null
}

function send(slug: string, path: string, body: Record<string, unknown>) {
  try {
    const blob = new Blob([JSON.stringify(body)], { type: 'application/json' })
    // sendBeacon works on pagehide/unload
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`/api/deals/${slug}/${path}`, blob)
    } else {
      fetch(`/api/deals/${slug}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {})
    }
  } catch { /* swallow */ }
}

export function trackEventV2(slug: string, session_id: string, event_type: string, extras?: Record<string, unknown>) {
  const context = window.__skcDealTracking?.slug === slug ? window.__skcDealTracking : null
  send(slug, 'events', {
    event_id: randomEventId(),
    event_type,
    session_id,
    visitor_id: context?.visitor_id,
    buyer_id: context?.buyer_id,
    broadcast_id: context?.broadcast_id,
    broadcast_recipient_id: context?.broadcast_recipient_id,
    ref_code: context?.ref_code,
    share_id: context?.share_id,
    page_path: context?.page_path || window.location.pathname,
    page_location: context?.page_location || window.location.href,
    utm_source: context?.utm_source,
    utm_medium: context?.utm_medium,
    utm_campaign: context?.utm_campaign,
    utm_term: context?.utm_term,
    utm_content: context?.utm_content,
    ...extras,
  })
}

export function DealTracker({ slug }: { slug: string }) {
  const sessionIdRef = useRef<string | null>(null)
  const visitorIdRef = useRef<string | null>(null)
  const startedAtRef = useRef<number>(0)
  const activeTimeRef = useRef<number>(0)
  const lastActivityRef = useRef<number>(0)
  const maxScrollRef = useRef<number>(0)
  const interactionsRef = useRef<number>(0)
  const sectionsRef = useRef<Set<string>>(new Set())
  const bouncedRef = useRef<boolean>(true)
  const convertedRef = useRef<boolean>(false)
  const conversionTypeRef = useRef<string | null>(null)
  const focusedRef = useRef<boolean>(true)

  useEffect(() => {
    const startedAt = Date.now()
    startedAtRef.current = startedAt
    lastActivityRef.current = startedAt
    const session_id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
    const visitor_id = getOrCreateId('skc_visitor_id', localStorage)
    sessionIdRef.current = session_id
    visitorIdRef.current = visitor_id

    const params = new URLSearchParams(window.location.search)
    const device = detectDevice()
    const refCode = getParam(params, 's') || getParam(params, 'ref')
    const shareId = getParam(params, 'share_id') || getParam(params, 's')
    const trackingContext = {
      slug,
      session_id,
      visitor_id,
      buyer_id: getParam(params, 'buyer_id') || getParam(params, 'buyer'),
      broadcast_id: getParam(params, 'broadcast_id') || getParam(params, 'broadcast'),
      broadcast_recipient_id:
        getParam(params, 'broadcast_recipient_id') ||
        getParam(params, 'recipient_id') ||
        getParam(params, 'recipient'),
      ref_code: refCode,
      share_id: shareId,
      page_path: window.location.pathname,
      page_location: window.location.href,
      utm_source: getParam(params, 'utm_source'),
      utm_medium: getParam(params, 'utm_medium'),
      utm_campaign: getParam(params, 'utm_campaign'),
      utm_term: getParam(params, 'utm_term'),
      utm_content: getParam(params, 'utm_content'),
    }
    window.__skcDealTracking = trackingContext

    // Initial session record
    send(slug, 'session', {
      action: 'start',
      session_id,
      visitor_id,
      buyer_id: trackingContext.buyer_id,
      broadcast_id: trackingContext.broadcast_id,
      broadcast_recipient_id: trackingContext.broadcast_recipient_id,
      referrer: document.referrer || null,
      ref_code: refCode,
      share_id: shareId,
      page_path: trackingContext.page_path,
      page_location: trackingContext.page_location,
      utm_source: trackingContext.utm_source,
      utm_medium: trackingContext.utm_medium,
      utm_campaign: trackingContext.utm_campaign,
      utm_term: trackingContext.utm_term,
      utm_content: trackingContext.utm_content,
      ...device,
      screen_width: window.screen.width,
      screen_height: window.screen.height,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
    })

    // Also fire a legacy page_view event for the simple stats
    trackEventV2(slug, session_id, 'page_view', {
      metadata: { device },
    })
    if (refCode) {
      trackEventV2(slug, session_id, 'share_visit', {
        share_id: shareId,
        metadata: { ref_code: refCode, share_id: shareId },
      })
    }

    // ── Active time tracking ──
    let lastTick = Date.now()
    const tick = setInterval(() => {
      const now = Date.now()
      const elapsed = now - lastTick
      lastTick = now
      const isActive = focusedRef.current && (now - lastActivityRef.current) < ACTIVITY_THRESHOLD_MS
      if (isActive) {
        activeTimeRef.current += elapsed
      }
    }, 1000)

    // ── Heartbeat (periodic session update) ──
    const sessionUpdate = (action: 'heartbeat' | 'end') => ({
      action,
      session_id,
      total_duration_ms: Date.now() - startedAtRef.current,
      active_duration_ms: activeTimeRef.current,
      max_scroll_pct: maxScrollRef.current,
      sections_viewed: Array.from(sectionsRef.current),
      interactions: interactionsRef.current,
      is_bounced: bouncedRef.current,
      converted: convertedRef.current,
      conversion_type: conversionTypeRef.current,
    })

    const heartbeat = setInterval(() => {
      send(slug, 'session', {
        ...sessionUpdate('heartbeat'),
      })
    }, HEARTBEAT_MS)

    // ── Activity listeners ──
    const markActive = () => {
      lastActivityRef.current = Date.now()
      if (bouncedRef.current) bouncedRef.current = false
    }
    window.addEventListener('mousemove', markActive, { passive: true })
    window.addEventListener('touchstart', markActive, { passive: true })
    window.addEventListener('keydown', markActive, { passive: true })

    // ── Scroll tracking + heat map prep ──
    const handleScroll = () => {
      const doc = document.documentElement
      const scrollTop = doc.scrollTop || document.body.scrollTop
      const scrollHeight = doc.scrollHeight - doc.clientHeight
      const pct = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0
      if (pct > maxScrollRef.current) maxScrollRef.current = pct
      markActive()
    }
    window.addEventListener('scroll', handleScroll, { passive: true })

    // ── Click tracking with heat map coords ──
    const handleClick = (e: MouseEvent) => {
      markActive()
      interactionsRef.current++
      const target = e.target as HTMLElement
      const tag = target?.tagName?.toLowerCase() || 'unknown'
      const text = (target?.textContent || '').slice(0, 80).trim()
      const x_pct = (e.clientX / window.innerWidth) * 100
      const y_pct = (e.clientY / window.innerHeight) * 100
      const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight
      const scroll_pct = scrollHeight > 0 ? Math.round((window.scrollY / scrollHeight) * 100) : 0

      trackEventV2(slug, session_id, 'click', {
        metadata: {
          x_pct: Math.round(x_pct * 10) / 10,
          y_pct: Math.round(y_pct * 10) / 10,
          scroll_pct,
          tag,
          text: text.slice(0, 40),
        },
        x_pct,
        y_pct,
        scroll_pct,
        element_tag: tag,
        element_text: text.slice(0, 100),
      })
    }
    document.addEventListener('click', handleClick, { passive: true })

    // ── Section visibility ──
    const sectionTimers = new Map<string, number>()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.trackSection
        if (!key) continue
        if (entry.isIntersecting) {
          sectionTimers.set(key, window.setTimeout(() => {
            if (!sectionsRef.current.has(key)) {
              sectionsRef.current.add(key)
              trackEventV2(slug, session_id, 'section_view', { section: key, metadata: { section: key } })
            }
          }, SECTION_DWELL_MS))
        } else {
          const t = sectionTimers.get(key)
          if (t) { clearTimeout(t); sectionTimers.delete(key) }
        }
      }
    }, { threshold: 0.5 })
    document.querySelectorAll<HTMLElement>('[data-track-section]').forEach(el => observer.observe(el))

    // ── Focus/blur ──
    const handleVisibility = () => { focusedRef.current = !document.hidden }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', () => { focusedRef.current = true })
    window.addEventListener('blur', () => { focusedRef.current = false })

    // ── Session end ──
    const endSession = () => {
      send(slug, 'session', {
        ...sessionUpdate('end'),
      })
    }
    window.addEventListener('pagehide', endSession)
    window.addEventListener('beforeunload', endSession)

    // Listen for conversion events from other components
    const onConversion = (e: Event) => {
      const ce = e as CustomEvent
      const type = typeof ce.detail?.type === 'string' ? ce.detail.type : 'conversion'
      convertedRef.current = true
      conversionTypeRef.current = type
      trackEventV2(slug, session_id, type, {
        metadata: ce.detail?.metadata || {},
      })
      send(slug, 'session', {
        ...sessionUpdate('heartbeat'),
        converted: true,
        conversion_type: type,
      })
    }
    window.addEventListener('skc:conversion', onConversion)

    return () => {
      clearInterval(tick)
      clearInterval(heartbeat)
      window.removeEventListener('mousemove', markActive)
      window.removeEventListener('touchstart', markActive)
      window.removeEventListener('keydown', markActive)
      window.removeEventListener('scroll', handleScroll)
      document.removeEventListener('click', handleClick)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', endSession)
      window.removeEventListener('beforeunload', endSession)
      window.removeEventListener('skc:conversion', onConversion)
      observer.disconnect()
      endSession()
      if (window.__skcDealTracking?.session_id === session_id) {
        delete window.__skcDealTracking
      }
    }
  }, [slug])

  return null
}

// Helper for other components to fire events without managing session IDs
export function dispatchConversion(type: string, extras?: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent('skc:conversion', { detail: { type, metadata: extras } }))
}
