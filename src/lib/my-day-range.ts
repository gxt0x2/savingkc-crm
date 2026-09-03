export const MY_DAY_TIME_ZONE = 'America/Chicago'

export type MyDayRangePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'last_7_days'
  | 'month_to_date'
  | 'previous_month'
  | 'last_30_days'
  | 'custom'

export interface MyDayDateRange {
  preset: MyDayRangePreset
  from: string
  to: string
  label: string
}

export interface MyDayRangeRequest {
  preset?: string | null
  from?: string | null
  to?: string | null
  month?: string | null
}

const DATE_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/
const RANGE_PRESETS = new Set<MyDayRangePreset>([
  'today', 'yesterday', 'this_week', 'last_week', 'last_7_days',
  'month_to_date', 'previous_month', 'last_30_days', 'custom',
])
const DATE_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: MY_DAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const CENTRAL_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: MY_DAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function centralDateKey(value: Date): string {
  return DATE_KEY.format(value)
}

function validDateKey(value: string | null | undefined): value is string {
  if (!value || !DATE_KEY_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Convert an America/Chicago calendar date at midnight to its exact UTC instant. */
export function centralMidnightUtc(value: string): Date {
  if (!validDateKey(value)) throw new Error('Invalid Central date key')
  const [year, month, day] = value.split('-').map(Number)
  const wallClockUtc = Date.UTC(year, month - 1, day)
  let instant = wallClockUtc
  for (let index = 0; index < 3; index += 1) {
    const parts = Object.fromEntries(CENTRAL_PARTS.formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
    const representedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
    instant = wallClockUtc - (representedAsUtc - instant)
  }
  return new Date(instant)
}

export function shiftMyDayDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function startOfMyDayWeek(value: string): string {
  const weekday = new Date(`${value}T12:00:00Z`).getUTCDay()
  return shiftMyDayDate(value, weekday === 0 ? -6 : 1 - weekday)
}

function endOfMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber, 0, 12)).toISOString().slice(0, 10)
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${month}-15T12:00:00Z`))
}

function customRangeLabel(from: string, to: string): string {
  const start = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  if (from === to) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(start)
  }
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
  const startLabel = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric', timeZone: 'UTC',
  }).format(start)
  const endLabel = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(end)
  return `${startLabel} – ${endLabel}`
}

export function resolveMyDayDateRange(request: MyDayRangeRequest = {}, now = new Date()): MyDayDateRange {
  const today = centralDateKey(now) || now.toISOString().slice(0, 10)
  const requestedPreset = RANGE_PRESETS.has(request.preset as MyDayRangePreset)
    ? request.preset as MyDayRangePreset
    : null

  if (!requestedPreset && request.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(request.month)) {
    const from = `${request.month}-01`
    const requestedEnd = endOfMonth(request.month)
    const to = requestedEnd > today ? today : requestedEnd
    return { preset: 'custom', from, to, label: monthLabel(request.month) }
  }

  const preset = requestedPreset ?? 'today'
  let from = today
  let to = today

  if (preset === 'yesterday') from = to = shiftMyDayDate(today, -1)
  if (preset === 'this_week') from = startOfMyDayWeek(today)
  if (preset === 'last_week') {
    from = shiftMyDayDate(startOfMyDayWeek(today), -7)
    to = shiftMyDayDate(from, 6)
  }
  if (preset === 'last_7_days') from = shiftMyDayDate(today, -6)
  if (preset === 'month_to_date') from = `${today.slice(0, 7)}-01`
  if (preset === 'previous_month') {
    const previousMonthEnd = shiftMyDayDate(`${today.slice(0, 7)}-01`, -1)
    from = `${previousMonthEnd.slice(0, 7)}-01`
    to = previousMonthEnd
  }
  if (preset === 'last_30_days') from = shiftMyDayDate(today, -29)
  if (preset === 'custom') {
    const requestedFrom = validDateKey(request.from) ? request.from : today
    const requestedTo = validDateKey(request.to) ? request.to : requestedFrom
    to = requestedTo > today ? today : requestedTo
    from = requestedFrom > to ? to : requestedFrom
    if (shiftMyDayDate(from, 89) < to) from = shiftMyDayDate(to, -89)
  }

  const labels: Partial<Record<MyDayRangePreset, string>> = {
    today: 'Today', yesterday: 'Yesterday', this_week: 'This week', last_week: 'Last week',
    last_7_days: 'Last 7 days', month_to_date: 'Month to date', previous_month: 'Previous month',
    last_30_days: 'Last 30 days',
  }
  return { preset, from, to, label: labels[preset] ?? customRangeLabel(from, to) }
}
