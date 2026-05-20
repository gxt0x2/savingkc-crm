/**
 * PPC Attribution
 *
 * Parses UTM params + gclid from the URL on first visit, persists them in
 * sessionStorage, and rehydrates them on every quiz POST so Google Ads
 * attribution survives intra-page navigation and form-step transitions.
 */

export interface AttributionPayload {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  gclid?: string
  gbraid?: string
  wbraid?: string
  gad_source?: string
  gad_campaignid?: string
  gad_adgroupid?: string
  gad_creative?: string
  gad_matchtype?: string
  gad_network?: string
  gad_device?: string
  referrer?: string
  landingUrl: string
}

const STORAGE_KEY = 'skc.ppc.attribution.v1'

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'gbraid',
  'wbraid',
  'gad_source',
  'gad_campaignid',
  'gad_adgroupid',
  'gad_creative',
  'gad_matchtype',
  'gad_network',
  'gad_device',
] as const

export function captureAttribution(): AttributionPayload | null {
  if (typeof window === 'undefined') return null

  // Prefer the first-visit snapshot — don't let downstream nav overwrite it
  const stored = readStored()
  if (stored) return stored

  const params = new URLSearchParams(window.location.search)
  const payload: AttributionPayload = {
    landingUrl: window.location.href,
    referrer: document.referrer || undefined,
  }
  for (const key of UTM_KEYS) {
    const val = params.get(key)
    if (val) (payload as unknown as Record<string, string>)[key] = val
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // sessionStorage may be unavailable (privacy mode, etc.) — fail open
  }
  return payload
}

export function getAttribution(): AttributionPayload | null {
  if (typeof window === 'undefined') return null
  return readStored() ?? captureAttribution()
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
