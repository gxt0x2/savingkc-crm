/**
 * The calling list locks at 4:00am America/Chicago.
 * The Matrix file is expected around 1:30am CT. The loader window is 2:30–3:30am CT.
 *
 * Vercel cron is UTC, so the route is scheduled at all three of these and
 * ignores the tick that is outside the local window:
 * - 07:30 UTC = 2:30am CDT (load) or 1:30am CST (idle)
 * - 08:30 UTC = 3:30am CDT (deadline) or 2:30am CST (load)
 * - 09:30 UTC = 4:30am CDT (idle) or 3:30am CST (deadline)
 */

export interface ChicagoClock {
  date: string
  hour: number
  minute: number
}

export function chicagoClock(instant: Date): ChicagoClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  let hour = Number(read('hour'))
  if (hour === 24) hour = 0
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    hour,
    minute: Number(read('minute')),
  }
}

export function addIsoDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const utc = new Date(Date.UTC(year, month - 1, day))
  utc.setUTCDate(utc.getUTCDate() + days)
  return utc.toISOString().slice(0, 10)
}

/** Adds and tags at or after 4:00am CT count on the next calling list. */
export function additionListDay(instant: Date): string {
  const clock = chicagoClock(instant)
  if (clock.hour >= 4) return addIsoDays(clock.date, 1)
  return clock.date
}

export type MarketCheckWindow = 'load' | 'deadline' | 'idle'

/** 2:30am inclusive through 3:29am is the load. 3:30am through 3:59am is the miss deadline. */
export function marketCheckWindow(instant: Date): MarketCheckWindow {
  const clock = chicagoClock(instant)
  const minutes = clock.hour * 60 + clock.minute
  if (minutes >= 150 && minutes < 210) return 'load'
  if (minutes >= 210 && minutes < 240) return 'deadline'
  return 'idle'
}

/** off_market_ok is written only when the file is in before 3:30am CT. */
export function offMarketAllowed(instant: Date): boolean {
  const clock = chicagoClock(instant)
  return clock.hour * 60 + clock.minute < 210
}
