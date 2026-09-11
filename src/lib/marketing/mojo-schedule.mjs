import { isSavingKcWorkday } from '../company-calendar-rules.mjs'

export function mojoSchedule(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]))
  const date = `${parts.year}-${parts.month}-${parts.day}`
  const minute = Number(parts.hour) * 60 + Number(parts.minute)
  const businessHours = isSavingKcWorkday(date) && minute >= 480 && minute < 1080
  return { date, businessHours, minutesSinceOpen: businessHours ? minute - 480 : 0,
    withinStartupGrace: businessHours && minute < 510 }
}

/** Only age within the current calling window; closed hours are never missed runs.
 * @param {string | null} lastSyncAt
 */
export function mojoCallingAge(lastSyncAt, now = new Date()) {
  const schedule = mojoSchedule(now)
  if (!schedule.businessHours) return 0
  const elapsed = lastSyncAt ? (now.getTime() - Date.parse(lastSyncAt)) / 60_000 : Infinity
  return Math.max(0, Math.min(schedule.minutesSinceOpen, Number.isFinite(elapsed) ? Math.floor(elapsed) : Infinity))
}
