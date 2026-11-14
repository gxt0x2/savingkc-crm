import { areaCodeTimeZone } from '@/lib/phone-area-code-time'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

/** 47 CFR 64.1200(c)(1): not before 8:00am and not at or after 9:00pm local. */
const LOCAL_START_MINUTE = 8 * 60
const LOCAL_END_MINUTE = 21 * 60
/** Unknown zones use the overlap of 8:00am–9:00pm across the continental US, in Central time. */
const SAFE_START_MINUTE = 10 * 60
const SAFE_END_MINUTE = 20 * 60
const CENTRAL = 'America/Chicago'

function areaCode(phone: string): string {
  const canonical = normalizePhoneToE164(phone)
  if (!canonical) return ''
  return canonical.slice(2, 5)
}

function minutesInZone(now: Date, timeZone: string): number | null {
  if (!Number.isFinite(now.getTime())) return null
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
    const hour = Number(parts.find((part) => part.type === 'hour')?.value)
    const minute = Number(parts.find((part) => part.type === 'minute')?.value)
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
    return ((hour % 24) * 60) + minute
  } catch {
    return null
  }
}

function inside(now: Date, timeZone: string, start: number, end: number): boolean {
  const minutes = minutesInZone(now, timeZone)
  return minutes !== null && minutes >= start && minutes < end
}

/**
 * True when a human text is inside the recipient's allowed hours.
 * A known area code uses 8:00am–9:00pm in that zone. A ported or split code
 * must sit inside that window for America/Chicago and for every zone the code
 * spans. An unknown code uses 10:00am–8:00pm Central.
 */
export function isWithinRecipientSmsHours(phone: string, now = new Date()): boolean {
  const zone = areaCodeTimeZone(areaCode(phone))
  if (zone.kind === 'unknown') return inside(now, CENTRAL, SAFE_START_MINUTE, SAFE_END_MINUTE)
  const zones = zone.kind === 'known'
    ? [zone.timeZone]
    : [...new Set([CENTRAL, ...zone.timeZones])]
  return zones.every((timeZone) => inside(now, timeZone, LOCAL_START_MINUTE, LOCAL_END_MINUTE))
}
