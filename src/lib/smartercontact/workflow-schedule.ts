/** Shared scheduling math for workflow drip steps. */

export interface StepDelay {
  delay_days: number
  delay_hours: number
}

/** Milliseconds represented by a step's (delay_days, delay_hours). */
export function stepDelayMs(step: StepDelay): number {
  const days = Math.max(0, step.delay_days || 0)
  const hours = Math.max(0, step.delay_hours || 0)
  return (days * 24 + hours) * 60 * 60 * 1000
}

/** ISO timestamp for `now + step delay`. */
export function nextRunAt(step: StepDelay, from: Date = new Date()): string {
  return new Date(from.getTime() + stepDelayMs(step)).toISOString()
}
