export const CHICAGO = 'America/Chicago'

export type TaxStatusPhase = 'nightly' | 'weekly' | 'pre_export' | 'suppress_only' | 'idle'

export interface ChicagoClock {
  date: string
  hour: number
  minute: number
  weekday: string
}

export interface TaxStatusWindow {
  phase: TaxStatusPhase
  /** Before 4:00am Chicago the nightly/weekly batch may promote newly verified tax rows. */
  allowAdd: boolean
  /** County sources are called only in the 3:00am batch. */
  callSources: boolean
  clock: ChicagoClock
}

export function chicagoClock(now: Date): ChicagoClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  const hour = Number(read('hour'))
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    hour: hour === 24 ? 0 : hour,
    minute: Number(read('minute')),
    weekday: read('weekday'),
  }
}

/**
 * 3:00am America/Chicago verifies. Sunday 3:00am is the weekly recheck.
 * 7:55am is the pre-export scrub. Any other run at or after 4:00am may only
 * suppress. Earlier hours do nothing so the extra UTC cron tick is a no-op.
 */
export function taxStatusWindow(now: Date): TaxStatusWindow {
  const clock = chicagoClock(now)
  if (clock.hour === 7 && clock.minute === 55) {
    return { phase: 'pre_export', allowAdd: false, callSources: false, clock }
  }
  if (clock.hour === 3) {
    const weekly = clock.weekday === 'Sun'
    return {
      phase: weekly ? 'weekly' : 'nightly',
      allowAdd: true,
      callSources: true,
      clock,
    }
  }
  if (clock.hour >= 4) {
    return { phase: 'suppress_only', allowAdd: false, callSources: false, clock }
  }
  return { phase: 'idle', allowAdd: false, callSources: false, clock }
}

export function chicagoDateOf(iso: string | null | undefined, nowFallback?: Date): string | null {
  if (!iso) return null
  const parsed = new Date(iso)
  if (!Number.isFinite(parsed.getTime())) return nowFallback ? chicagoClock(nowFallback).date : null
  return chicagoClock(parsed).date
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export function inNightlyScope(createdAt: string, scoredAt: string | null, chicagoDate: string): boolean {
  return chicagoDateOf(createdAt) === chicagoDate || chicagoDateOf(scoredAt) === chicagoDate
}

export function inWeeklyScope(input: {
  createdAt: string
  onDialerList: boolean
  rowStatus: string | null
  now: Date
}): boolean {
  if (input.rowStatus === 'dropped' || input.rowStatus === 'excluded_entity') return false
  if (input.onDialerList) return true
  const created = Date.parse(input.createdAt)
  if (!Number.isFinite(created)) return false
  return input.now.getTime() - created > THIRTY_DAYS_MS
}
