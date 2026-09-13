// The first connected pilot supports the agreed America/Chicago operating zone.
// Convert local calendar components explicitly so DST does not turn day 8 into
// a fixed 192-hour delay. Provider acceptance remains the schedule anchor.
const timezone = 'America/Chicago'
function parts(date: Date) {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (name: string) =>
    Number(values.find((p) => p.type === name)?.value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  }
}
function localTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  const target = Date.UTC(year, month - 1, day, hour, minute)
  let guess = target
  for (let pass = 0; pass < 3; pass++) {
    const p = parts(new Date(guess))
    guess += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  }
  return new Date(guess)
}
export function pilotFollowUp(acceptedAt: Date) {
  if (!Number.isFinite(acceptedAt.getTime()))
    throw new Error('INVALID_ACCEPTANCE_TIME')
  const local = parts(acceptedAt)
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day + 8))
  while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1)
  return localTime(
    day.getUTCFullYear(),
    day.getUTCMonth() + 1,
    day.getUTCDate(),
    Math.max(9, Math.min(local.hour, 16)),
    local.hour < 9 || local.hour >= 17 ? 0 : local.minute,
  )
}
export function pilotSendSlot(now: Date) {
  const p = parts(now)
  const day = new Date(
    Date.UTC(p.year, p.month - 1, p.day + (p.hour >= 17 ? 1 : 0)),
  )
  while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1)
  const sameDay =
    day.getUTCDate() === p.day && day.getUTCMonth() + 1 === p.month
  if (sameDay && p.hour >= 9 && p.hour < 17) return now
  return localTime(
    day.getUTCFullYear(),
    day.getUTCMonth() + 1,
    day.getUTCDate(),
    9,
    0,
  )
}

export function pilotFollowUpExpires(acceptedAt: Date) {
  const p = parts(acceptedAt)
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day + 10))
  return localTime(
    day.getUTCFullYear(),
    day.getUTCMonth() + 1,
    day.getUTCDate(),
    17,
    0,
  )
}

/** Response SLA for a callback request. This is a task due time, not a booked
 * call. Use saved weekday hours, defaulting to 08:30-17:00 Chicago. */
export function pilotCallbackDue(
  now: Date,
  team?: {
    hours: { weekdays: string[]; startLocal: string; endLocal: string }
    sla: { urgentMinutes: number }
  },
) {
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_CALLBACK_TIME')
  const local = parts(now)
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day))
  const toMinutes = (value: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return Number.NaN
    const [hour, minute] = value.split(':').map(Number)
    return hour * 60 + minute
  }
  const start = team ? toMinutes(team.hours.startLocal) : 8 * 60 + 30
  const end = team ? toMinutes(team.hours.endLocal) : 17 * 60
  const weekdays = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ]
  const allowed = team?.hours.weekdays ?? weekdays.slice(1, 6)
  if (
    !allowed.length ||
    !allowed.every((day) => weekdays.slice(1, 6).includes(day)) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 510 ||
    end > 1439 ||
    start >= end
  )
    throw new Error('INVALID_CALLBACK_HOURS')
  const open = () =>
    ![0, 6].includes(day.getUTCDay()) &&
    allowed.includes(weekdays[day.getUTCDay()])
  let minutes = local.hour * 60 + local.minute + (team?.sla.urgentMinutes ?? 30)
  if (open() && minutes >= start && minutes <= end)
    return localTime(
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      Math.floor(minutes / 60),
      minutes % 60,
    )
  if (open() && minutes < start)
    return localTime(
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      Math.floor(start / 60),
      start % 60,
    )
  do day.setUTCDate(day.getUTCDate() + 1)
  while (!open())
  minutes = start
  return localTime(
    day.getUTCFullYear(),
    day.getUTCMonth() + 1,
    day.getUTCDate(),
    Math.floor(minutes / 60),
    minutes % 60,
  )
}
