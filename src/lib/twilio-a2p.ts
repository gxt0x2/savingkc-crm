// Server-only: reads the live A2P 10DLC brand registration from Twilio so the
// SMS guardrail tracks our REAL carrier throughput tier instead of a hardcoded
// guess. Reuses the same API-key auth as /api/admin/dialer-health.
//
// Cached in-memory with a long TTL and a fail-open fallback so the hot send
// path never blocks on (or breaks because of) Twilio:
//   • resolveSmsCaps()  — non-blocking; used by the bulk-SMS budget on every
//     request. Returns fresh cache, else a stale/fallback value while kicking a
//     background refresh.
//   • fetchA2pDiagnostic() — awaits a fresh lookup; used by the admin dialer
//     health endpoint where latency is fine and we want authoritative numbers.
//
// Override order: SMS_HARD_PER_DAY / SMS_HARD_PER_HOUR env (zero-deploy manual
// control) → live Twilio tier (when SMS_A2P_AUTODETECT !== 'false') → fallback.

import {
  A2P_FALLBACK_DAILY_CAP,
  buildTierInfo,
  FALLBACK_TIER,
  hourlyCapForDaily,
  type A2pBrandType,
  type A2pTierInfo,
} from './a2p-tier'

const MESSAGING_BASE = 'https://messaging.twilio.com/v1'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h — a brand's tier changes rarely.

interface CacheEntry { tier: A2pTierInfo; at: number }
let cache: CacheEntry | null = null
let inFlight: Promise<A2pTierInfo> | null = null

const autodetectEnabled = (): boolean => process.env.SMS_A2P_AUTODETECT !== 'false'

/** Basic-auth header, preferring an API key (SK…) and falling back to the auth token. */
function twilioAuthHeader(): string | null {
  const { TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env
  if (TWILIO_API_KEY && TWILIO_API_SECRET) {
    return 'Basic ' + Buffer.from(`${TWILIO_API_KEY}:${TWILIO_API_SECRET}`).toString('base64')
  }
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    return 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')
  }
  return null
}

function normalizeBrandType(raw: unknown): A2pBrandType {
  const s = String(raw ?? '').toUpperCase()
  if (s.includes('SOLE')) return 'SOLE_PROPRIETOR'
  if (s.includes('STARTER')) return 'STARTER'
  if (s.includes('STANDARD')) return 'STANDARD'
  return 'UNKNOWN'
}

/** Secondary vetting passed → identity_status like VETTED_VERIFIED. */
function isVetted(brand: Record<string, unknown>): boolean {
  return String(brand.identity_status ?? '').toUpperCase().includes('VETTED')
}

export interface A2pDiagnostic {
  tier: A2pTierInfo
  /** Raw fields from the chosen brand registration, for admin debugging. */
  detail: {
    brandCount: number
    brandSid: string | null
    status: string | null
    identityStatus: string | null
    brandType: string | null
    brandScore: number | null
  } | null
}

const EMPTY_DETAIL: A2pDiagnostic['detail'] = null

/** One-shot lookup of the account's A2P brand registration(s) from Twilio. */
async function lookupTierDetailed(): Promise<A2pDiagnostic> {
  const auth = twilioAuthHeader()
  if (!auth) return { tier: FALLBACK_TIER, detail: EMPTY_DETAIL }
  try {
    const res = await fetch(`${MESSAGING_BASE}/a2p/BrandRegistrations?PageSize=50`, {
      headers: { Authorization: auth },
      cache: 'no-store',
    })
    if (!res.ok) return { tier: FALLBACK_TIER, detail: EMPTY_DETAIL }
    const json = (await res.json()) as Record<string, unknown>
    // Twilio messaging list responses key the array as `data`; tolerate the
    // older `brand_registrations` name too.
    const list = (Array.isArray(json.data)
      ? json.data
      : Array.isArray((json as { brand_registrations?: unknown[] }).brand_registrations)
        ? (json as { brand_registrations: unknown[] }).brand_registrations
        : []) as Array<Record<string, unknown>>
    if (list.length === 0) return { tier: FALLBACK_TIER, detail: { ...baseDetail(null), brandCount: 0 } }

    // Prefer an APPROVED brand, then the highest trust score.
    const top = [...list]
      .map((b) => ({ b, score: Number(b.brand_score) || 0, approved: String(b.status ?? '').toUpperCase() === 'APPROVED' }))
      .sort((a, z) => Number(z.approved) - Number(a.approved) || z.score - a.score)[0].b

    const rawScore = Number(top.brand_score)
    const trustScore = Number.isFinite(rawScore) && rawScore > 0 ? Math.round(rawScore) : null
    const brandType = normalizeBrandType(top.brand_type)
    const vetted = isVetted(top)

    return {
      tier: buildTierInfo({ trustScore, brandType, vetted }, 'twilio'),
      detail: {
        brandCount: list.length,
        brandSid: typeof top.sid === 'string' ? top.sid : null,
        status: typeof top.status === 'string' ? top.status : null,
        identityStatus: typeof top.identity_status === 'string' ? top.identity_status : null,
        brandType: typeof top.brand_type === 'string' ? top.brand_type : null,
        brandScore: trustScore,
      },
    }
  } catch {
    return { tier: FALLBACK_TIER, detail: EMPTY_DETAIL }
  }
}

function baseDetail(sid: string | null): NonNullable<A2pDiagnostic['detail']> {
  return { brandCount: 0, brandSid: sid, status: null, identityStatus: null, brandType: null, brandScore: null }
}

/** Deduped background refresh that warms the cache. Never rejects. */
function refresh(): Promise<A2pTierInfo> {
  if (!inFlight) {
    inFlight = lookupTierDetailed()
      .then(({ tier }) => {
        cache = { tier, at: Date.now() }
        return tier
      })
      .catch(() => FALLBACK_TIER)
      .finally(() => { inFlight = null })
  }
  return inFlight
}

function freshCachedTier(): A2pTierInfo | null {
  return cache && Date.now() - cache.at < CACHE_TTL_MS ? cache.tier : null
}

/** Manual env override (SMS_HARD_PER_DAY / SMS_HARD_PER_HOUR), if set. */
function envTier(): A2pTierInfo | null {
  const day = Number(process.env.SMS_HARD_PER_DAY)
  if (!Number.isFinite(day) || day <= 0) return null
  return {
    trustScore: null,
    brandType: 'UNKNOWN',
    vetted: false,
    carrierDailyCap: Math.floor(day),
    label: 'Manual override (env)',
    source: 'env',
  }
}

export interface ResolvedSmsCaps {
  perHour: number
  perDay: number
  tier: A2pTierInfo
}

function capsFromTier(tier: A2pTierInfo): ResolvedSmsCaps {
  // An explicit per-hour env override wins over the derived hourly value.
  const envHour = Number(process.env.SMS_HARD_PER_HOUR)
  const perHour = tier.source === 'env' && Number.isFinite(envHour) && envHour > 0
    ? Math.floor(envHour)
    : hourlyCapForDaily(tier.carrierDailyCap)
  return { perHour, perDay: tier.carrierDailyCap, tier }
}

/** Max time the send path will wait on a cold-cache Twilio lookup. */
const LOOKUP_TIMEOUT_MS = 2500

/**
 * Effective SMS caps for the guardrail. Prefers an env override, then a fresh
 * cached tier. On a cold/stale cache it awaits a refresh but only up to
 * LOOKUP_TIMEOUT_MS, then falls back — so a healthy Twilio gives us the REAL
 * cap on the first request while a slow/broken one can never stall a send.
 * Once warmed, the module cache serves subsequent requests instantly for 6h.
 */
export async function resolveSmsCaps(): Promise<ResolvedSmsCaps> {
  const env = envTier()
  if (env) return capsFromTier(env)
  if (!autodetectEnabled()) return capsFromTier(FALLBACK_TIER)

  const fresh = freshCachedTier()
  if (fresh) return capsFromTier(fresh)

  const tier = await Promise.race([
    refresh(),
    new Promise<A2pTierInfo>((resolve) =>
      setTimeout(() => resolve(cache?.tier ?? FALLBACK_TIER), LOOKUP_TIMEOUT_MS),
    ),
  ]).catch(() => cache?.tier ?? FALLBACK_TIER)
  return capsFromTier(tier)
}

/**
 * Authoritative tier + raw detail for diagnostics. Awaits a fresh lookup when
 * the cache is cold/stale. Used by the admin dialer-health endpoint.
 */
export async function fetchA2pDiagnostic(): Promise<A2pDiagnostic> {
  const env = envTier()
  if (env) return { tier: env, detail: EMPTY_DETAIL }
  if (!autodetectEnabled()) return { tier: FALLBACK_TIER, detail: EMPTY_DETAIL }

  const fresh = freshCachedTier()
  if (fresh) {
    // Re-fetch detail (cheap, admin-only) so the operator sees live raw fields.
    const live = await lookupTierDetailed()
    cache = { tier: live.tier, at: Date.now() }
    return live
  }
  return lookupTierDetailed().then((d) => {
    cache = { tier: d.tier, at: Date.now() }
    return d
  })
}

/** Carrier daily cap currently in effect (env → cache → fallback). Sync. */
export function currentDailyCap(): number {
  return envTier()?.carrierDailyCap ?? freshCachedTier()?.carrierDailyCap ?? A2P_FALLBACK_DAILY_CAP
}
