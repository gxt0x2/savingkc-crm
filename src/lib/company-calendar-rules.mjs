const DATE_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/

/** @param {string} value */
function dateFromKey(value) {
  if (!DATE_KEY_PATTERN.test(value)) return null
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null
}

/**
 * SavingKC closures that have been explicitly confirmed by the business.
 * Keep this list narrower than the federal calendar so an unconfirmed holiday
 * never silently removes a workday from goals or health monitoring.
 */
/** @param {string} value */
export function savingKcHoliday(value) {
  const date = dateFromKey(value)
  if (!date) return null

  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  const weekday = date.getUTCDay()

  // Labor Day: first Monday in September.
  if (month === 9 && weekday === 1 && day <= 7) {
    return { name: 'Labor Day', date: value }
  }

  return null
}

/** @param {string} value */
export function isSavingKcWorkday(value) {
  const date = dateFromKey(value)
  if (!date) return false
  const weekday = date.getUTCDay()
  return weekday >= 1 && weekday <= 5 && !savingKcHoliday(value)
}
