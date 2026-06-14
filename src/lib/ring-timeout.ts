// Map a configured "rings" count to a Twilio <Dial> timeout (seconds).
//
// A US ring cycle is ~6s (2s ring + 4s silence), so N rings ≈ 6N seconds. The
// dialer lets agents choose how long to let a number ring before giving up;
// this converts that into the Dial timeout. Falls back to the historical 15s
// default whenever the value is missing or invalid, so callers that don't pass
// a ring count behave exactly as before.

export const DEFAULT_DIAL_TIMEOUT = 15
const SECONDS_PER_RING = 6
const MIN_TIMEOUT = 10
const MAX_TIMEOUT = 60

export function parseDialTimeout(raw: string | number | null | undefined, fallback = DEFAULT_DIAL_TIMEOUT): number {
  const rings = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(rings) || rings <= 0) return fallback
  const seconds = Math.round(rings * SECONDS_PER_RING)
  return Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, seconds))
}
