// A2P 10DLC throughput tiers — the carrier-imposed ceiling on outbound SMS for
// a registered brand. Pure config + helpers (no network/DB), so it is safe to
// import from client components alongside sms-rate-limit.
//
// Source: T-Mobile (incl. Sprint / MetroPCS) daily message limits by brand type
// and Trust Score. T-Mobile publishes the tightest *daily* cap of the major US
// carriers, so we treat it as the account-wide ceiling — staying under it keeps
// us clear of carrier filtering (error 30007) on the strictest network.
//
//   Sole Proprietor brand .................... 1,000 / day
//   Low-volume Standard (no secondary vetting)  2,000 / day  (Russell 3000 → 200,000)
//   Vetted Standard brand, by Trust Score:
//     75–100 ................................. 200,000 / day
//     50–74 ..................................  40,000 / day
//     25–49 ..................................  10,000 / day
//      1–24 ..................................   2,000 / day
//
// Carrier daily limits reset at midnight Pacific; our own counter resets at
// midnight Central (see sms-rate-limit), which is strictly more conservative.

export type A2pBrandType = 'STANDARD' | 'SOLE_PROPRIETOR' | 'STARTER' | 'UNKNOWN'

export interface A2pTierInput {
  /** Twilio brand_score (0–100), or null when unknown / not yet scored. */
  trustScore: number | null
  brandType: A2pBrandType
  /** True when the brand passed external secondary vetting. */
  vetted: boolean
  /** Rare: publicly-traded Russell 3000 brands get the top tier unvetted. */
  russell3000?: boolean
}

export interface A2pTierInfo {
  trustScore: number | null
  brandType: A2pBrandType
  vetted: boolean
  /** Carrier (T-Mobile) daily SMS-segment ceiling for this brand. */
  carrierDailyCap: number
  /** Human label, e.g. "Vetted Standard · score 62". */
  label: string
  /** Where the numbers came from. */
  source: 'twilio' | 'env' | 'fallback'
}

/** Conservative ceilings used when the brand tier can't be determined. */
export const A2P_FALLBACK_DAILY_CAP = 2000
export const A2P_FALLBACK_HOURLY_CAP = 300

/** T-Mobile daily cap for a vetted Standard brand at a given Trust Score. */
export function dailyCapForTrustScore(score: number | null): number {
  if (score == null || !Number.isFinite(score)) return A2P_FALLBACK_DAILY_CAP
  if (score >= 75) return 200_000
  if (score >= 50) return 40_000
  if (score >= 25) return 10_000
  return 2_000
}

/** Resolve the carrier daily ceiling from brand type + vetting + score. */
export function carrierDailyCap(input: A2pTierInput): number {
  if (input.brandType === 'SOLE_PROPRIETOR') return 1_000
  // Standard / Starter / unknown: an unvetted brand is held to the low-volume
  // cap regardless of score (unless it's a Russell 3000 company).
  if (!input.vetted) return input.russell3000 ? 200_000 : 2_000
  return dailyCapForTrustScore(input.trustScore)
}

/**
 * Sustainable hourly ceiling derived from the daily cap. Spreads the daily
 * allotment so a single hour can't burn most of it (~1/8th), but never drops
 * below the fallback so small-tier brands keep a usable hourly budget.
 */
export function hourlyCapForDaily(dailyCap: number): number {
  return Math.min(dailyCap, Math.max(A2P_FALLBACK_HOURLY_CAP, Math.round(dailyCap / 8)))
}

function brandTypeLabel(t: A2pBrandType): string {
  switch (t) {
    case 'SOLE_PROPRIETOR': return 'Sole Proprietor'
    case 'STANDARD': return 'Standard'
    case 'STARTER': return 'Starter'
    default: return 'Brand'
  }
}

/** Build a display tier from raw inputs (used after a Twilio lookup). */
export function buildTierInfo(input: A2pTierInput, source: A2pTierInfo['source']): A2pTierInfo {
  const vettedLabel = input.brandType === 'STANDARD' ? (input.vetted ? 'Vetted ' : 'Low-volume ') : ''
  const scoreLabel = input.trustScore != null ? ` · score ${input.trustScore}` : ''
  return {
    trustScore: input.trustScore,
    brandType: input.brandType,
    vetted: input.vetted,
    carrierDailyCap: carrierDailyCap(input),
    label: `${vettedLabel}${brandTypeLabel(input.brandType)}${scoreLabel}`,
    source,
  }
}

/** The conservative fallback tier (matches pre-detection behavior). */
export const FALLBACK_TIER: A2pTierInfo = {
  trustScore: null,
  brandType: 'UNKNOWN',
  vetted: false,
  carrierDailyCap: A2P_FALLBACK_DAILY_CAP,
  label: 'Unverified (conservative default)',
  source: 'fallback',
}
