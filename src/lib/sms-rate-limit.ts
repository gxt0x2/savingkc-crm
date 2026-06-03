// Account-wide SMS volume guardrail — pure config + helpers (no DB import, so
// this is safe to use from client components too).
//
// Carrier spam-filtering and A2P 10DLC throughput are per-brand, so pacing is
// counted across EVERY sending number and agent, not per session. Two layers:
//
//   • HARD caps (constants below) — the firm ceiling no send path may exceed.
//     These are intentionally only changeable in code; they are the guardrail
//     that protects the company's number reputation.
//   • SOFT presets (per-hour / per-day) — operator-adjustable pacing set in the
//     bulk Text modal. Always clamped to the hard caps server-side.

/** Firm ceilings. Adjustable presets are always clamped to these. */
export const SMS_HARD_PER_HOUR = 300
export const SMS_HARD_PER_DAY = 2000

/** Out-of-the-box pacing (operator can change in the Text modal). */
export const SMS_DEFAULT_PER_HOUR = 150
export const SMS_DEFAULT_PER_DAY = 1000

export interface SmsPacePreset {
  id: string
  label: string
  perHour: number
  perDay: number
}

/** One-tap pacing presets shown in the Text modal. */
export const SMS_PACE_PRESETS: SmsPacePreset[] = [
  { id: 'cautious', label: 'Cautious', perHour: 75, perDay: 500 },
  { id: 'standard', label: 'Standard', perHour: SMS_DEFAULT_PER_HOUR, perDay: SMS_DEFAULT_PER_DAY },
  { id: 'maximum', label: 'Maximum', perHour: SMS_HARD_PER_HOUR, perDay: SMS_HARD_PER_DAY },
]

/** Clamp a requested per-hour pace to [1, HARD]. Falls back to the default. */
export function clampPerHour(value: unknown): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) return SMS_DEFAULT_PER_HOUR
  return Math.min(SMS_HARD_PER_HOUR, Math.max(1, n))
}

/** Clamp a requested per-day pace to [1, HARD]. Falls back to the default. */
export function clampPerDay(value: unknown): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) return SMS_DEFAULT_PER_DAY
  return Math.min(SMS_HARD_PER_DAY, Math.max(1, n))
}

export interface SmsBudget {
  perHour: number
  perDay: number
  hardPerHour: number
  hardPerDay: number
  usedHour: number
  usedDay: number
  remainingHour: number
  remainingDay: number
  allowedNow: number
  /** When the trailing-hour budget frees up (oldest in-window send + 1h). */
  hourResetsAt: string | null
  /** Next midnight Central — when the per-day count resets. */
  dayResetsAt: string
}

/** Midnight of the current America/Chicago day, as a UTC ISO instant. */
export function centralDayStartISO(now: Date = new Date()): string {
  // Reinterpret `now` as Central wall-clock, zero the time, then shift back to
  // the true instant. Works regardless of the server's own timezone.
  const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const diff = now.getTime() - central.getTime()
  central.setHours(0, 0, 0, 0)
  return new Date(central.getTime() + diff).toISOString()
}

/** Start of the next America/Chicago day (when the per-day count resets). */
export function nextCentralMidnightISO(now: Date = new Date()): string {
  return new Date(new Date(centralDayStartISO(now)).getTime() + 24 * 60 * 60 * 1000).toISOString()
}
