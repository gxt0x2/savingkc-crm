/**
 * PPC Attribution
 *
 * Parses UTM params + gclid from the URL on first visit, persists them in
 * sessionStorage and a first-party cookie, and rehydrates them on every quiz
 * POST so Google Ads attribution survives form-step transitions and return
 * visits inside the offline-conversion window.
 */

export interface AttributionPayload {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  keyword?: string
  matchtype?: string
  campaignid?: string
  adgroupid?: string
  gclid?: string
  gbraid?: string
  wbraid?: string
  gad_source?: string
  gad_campaignid?: string
  gad_adgroupid?: string
  referrer?: string
  landingUrl: string
}

const STORAGE_KEY = 'skc.ppc.attribution.v1'
const COOKIE_KEY = 'skc_ppc_attribution'
const COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'keyword',
  'matchtype',
  'campaignid',
  'adgroupid',
  'gclid',
  'gbraid',
  'wbraid',
  'gad_source',
  'gad_campaignid',
  'gad_adgroupid',
] as const

export function captureAttribution(): AttributionPayload | null {
  if (typeof window === 'undefined') return null

  // Prefer the first-visit snapshot — don't let downstream nav overwrite it
  const stored = readStored()
  if (stored) return stored

  const cookie = readCookie()
  if (cookie) {
    persistAttribution(cookie)
    return cookie
  }

  const params = new URLSearchParams(window.location.search)
  const payload: AttributionPayload = {
    landingUrl: window.location.href,
    referrer: document.referrer || undefined,
  }
  for (const key of UTM_KEYS) {
    const val = params.get(key)
    if (val) (payload as unknown as Record<string, string>)[key] = val
  }
  if (!hasAttributionSignal(payload)) return payload

  persistAttribution(payload)
  return payload
}

export function getAttribution(): AttributionPayload | null {
  if (typeof window === 'undefined') return null
  return readStored() ?? readCookie() ?? captureAttribution()
}

function hasAttributionSignal(payload: AttributionPayload): boolean {
  return UTM_KEYS.some((key) => Boolean((payload as unknown as Record<string, string | undefined>)[key]))
}

function cookieDomain(): string {
  const hostname = window.location.hostname
  if (hostname === 'savingkc.com' || hostname.endsWith('.savingkc.com')) return 'Domain=.savingkc.com'
  return ''
}

function cookieSecure(): string {
  return window.location.protocol === 'https:' ? 'Secure' : ''
}

function persistAttribution(payload: AttributionPayload): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // sessionStorage may be unavailable (privacy mode, etc.) — fail open
  }

  try {
    document.cookie = [
      `${COOKIE_KEY}=${encodeURIComponent(JSON.stringify(payload))}`,
      `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
      'Path=/',
      'SameSite=Lax',
      cookieDomain(),
      cookieSecure(),
    ].filter(Boolean).join('; ')
  } catch {
    // Cookies may be disabled or blocked. The in-memory form flow still works.
  }
}

function readCookie(): AttributionPayload | null {
  try {
    const raw = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${COOKIE_KEY}=`))
      ?.slice(COOKIE_KEY.length + 1)
    if (!raw) return null
    const parsed = JSON.parse(decodeURIComponent(raw)) as AttributionPayload
    if (typeof parsed?.landingUrl !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function readStored(): AttributionPayload | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AttributionPayload
    if (typeof parsed?.landingUrl !== 'string') return null
    return parsed
  } catch {
    return null
  }
}
