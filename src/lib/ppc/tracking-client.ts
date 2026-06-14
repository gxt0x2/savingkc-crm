import { getAttribution, type AttributionPayload } from '@/lib/ppc/attribution'

const VISITOR_STORAGE_SLOT = 'skc.ppc.visitor_id.v1'
const SESSION_STORAGE_SLOT = 'skc.ppc.session_id.v1'
const TRACKING_ENDPOINT = '/api/leads/ppc/track'

type BrowserWindow = Window & {
  dataLayer?: Array<Record<string, unknown>>
}

function randomId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `${prefix}_${rand}`
}

function storageGet(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function storageSet(storage: Storage | undefined, key: string, value: string) {
  try {
    storage?.setItem(key, value)
  } catch {
    // storage can be blocked in privacy mode
  }
}

export function getPpcSessionContext(): { visitorId: string | null; sessionId: string | null } {
  if (typeof window === 'undefined') return { visitorId: null, sessionId: null }

  let visitorId = storageGet(window.localStorage, VISITOR_STORAGE_SLOT)
  if (!visitorId) {
    visitorId = randomId('ppc_visitor')
    storageSet(window.localStorage, VISITOR_STORAGE_SLOT, visitorId)
  }

  let sessionId = storageGet(window.sessionStorage, SESSION_STORAGE_SLOT)
  if (!sessionId) {
    sessionId = randomId('ppc_session')
    storageSet(window.sessionStorage, SESSION_STORAGE_SLOT, sessionId)
  }

  return { visitorId, sessionId }
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isLikelyTest(payload: Record<string, unknown>, attribution: AttributionPayload | null): boolean {
  const values = [
    payload.event_id,
    payload.gclid,
    payload.gbraid,
    payload.wbraid,
    attribution?.gclid,
    attribution?.gbraid,
    attribution?.wbraid,
    typeof window !== 'undefined' ? window.location?.href : '',
  ]
  return values.some((value) => typeof value === 'string' && /(^|[^a-z0-9])(codex|test|dummy|probe|smoke)([^a-z0-9]|$)/i.test(value))
}

function safeAttribution() {
  try {
    return getAttribution()
  } catch {
    return null
  }
}

function browserContext(): Record<string, unknown> {
  if (typeof window === 'undefined') return {}

  return {
    screen_width: typeof window.screen?.width === 'number' ? window.screen.width : undefined,
    screen_height: typeof window.screen?.height === 'number' ? window.screen.height : undefined,
    viewport_width: typeof window.innerWidth === 'number' ? window.innerWidth : undefined,
    viewport_height: typeof window.innerHeight === 'number' ? window.innerHeight : undefined,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: window.navigator?.language,
    platform: window.navigator?.platform,
    hardware_concurrency: window.navigator?.hardwareConcurrency,
    touch_points: window.navigator?.maxTouchPoints,
  }
}

export function sendPpcTrackingEvent(dataLayerEvent: Record<string, unknown>) {
  if (typeof window === 'undefined') return

  const eventName = text(dataLayerEvent.event)
  const eventId = text(dataLayerEvent.event_id)
  if (!eventName || !eventId) return

  const attribution = safeAttribution()
  const { visitorId, sessionId } = getPpcSessionContext()
  const body = {
    eventId,
    eventName,
    eventTime: text(dataLayerEvent.event_time),
    sessionId: sessionId ?? undefined,
    visitorId: visitorId ?? undefined,
    pagePath: window.location?.pathname,
    pageLocation: window.location?.href,
    pageReferrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
    trafficSource: text(dataLayerEvent.traffic_source),
    campaign: text(dataLayerEvent.campaign),
    formStep: num(dataLayerEvent.form_step),
    formStatus: text(dataLayerEvent.form_status),
    situation: text(dataLayerEvent.situation),
    timeline: text(dataLayerEvent.timeline),
    condition: text(dataLayerEvent.condition),
    phoneNumber: text(dataLayerEvent.phone_number),
    smsConsent: bool(dataLayerEvent.sms_consent),
    attribution: attribution ?? undefined,
    isTest: isLikelyTest(dataLayerEvent, attribution),
    payload: {
      ...dataLayerEvent,
      browser: browserContext(),
    },
  }
  const json = JSON.stringify(body)

  const nav = window.navigator
  if (nav && typeof nav.sendBeacon === 'function') {
    const blob = new Blob([json], { type: 'application/json' })
    if (nav.sendBeacon(TRACKING_ENDPOINT, blob)) return
  }

  const w = window as BrowserWindow & { fetch?: typeof fetch }
  if (typeof w.fetch !== 'function') return

  w.fetch(TRACKING_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: json,
    keepalive: true,
  }).catch(() => undefined)
}
