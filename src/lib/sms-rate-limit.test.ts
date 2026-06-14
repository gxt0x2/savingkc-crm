import { describe, it, expect } from 'vitest'
import {
  SMS_HARD_PER_HOUR,
  SMS_HARD_PER_DAY,
  SMS_DEFAULT_PER_HOUR,
  SMS_DEFAULT_PER_DAY,
  SMS_PACE_PRESETS,
  clampPerHour,
  clampPerDay,
  centralDayStartISO,
  nextCentralMidnightISO,
} from './sms-rate-limit'

describe('sms-rate-limit guardrail', () => {
  it('clamps per-hour into [1, HARD] and falls back to default on junk', () => {
    expect(clampPerHour(50)).toBe(50)
    expect(clampPerHour(99999)).toBe(SMS_HARD_PER_HOUR) // never exceed the hard cap
    expect(clampPerHour(0)).toBe(SMS_DEFAULT_PER_HOUR)
    expect(clampPerHour(-5)).toBe(SMS_DEFAULT_PER_HOUR)
    expect(clampPerHour('abc')).toBe(SMS_DEFAULT_PER_HOUR)
    expect(clampPerHour(12.9)).toBe(12)
  })

  it('clamps per-day into [1, HARD]', () => {
    expect(clampPerDay(300)).toBe(300)
    expect(clampPerDay(999999)).toBe(SMS_HARD_PER_DAY)
    expect(clampPerDay(undefined)).toBe(SMS_DEFAULT_PER_DAY)
  })

  it('every preset stays within the hard caps', () => {
    for (const p of SMS_PACE_PRESETS) {
      expect(p.perHour).toBeGreaterThan(0)
      expect(p.perHour).toBeLessThanOrEqual(SMS_HARD_PER_HOUR)
      expect(p.perDay).toBeGreaterThan(0)
      expect(p.perDay).toBeLessThanOrEqual(SMS_HARD_PER_DAY)
    }
  })

  it('defaults are at or under the hard caps', () => {
    expect(SMS_DEFAULT_PER_HOUR).toBeLessThanOrEqual(SMS_HARD_PER_HOUR)
    expect(SMS_DEFAULT_PER_DAY).toBeLessThanOrEqual(SMS_HARD_PER_DAY)
  })

  it('CT day start is a past instant and next midnight is ~24h later', () => {
    const now = new Date('2026-06-03T14:30:00Z')
    const start = new Date(centralDayStartISO(now))
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime())
    const next = new Date(nextCentralMidnightISO(now))
    const diffHours = (next.getTime() - start.getTime()) / 3_600_000
    expect(diffHours).toBeGreaterThanOrEqual(23) // allows DST shift
    expect(diffHours).toBeLessThanOrEqual(25)
  })
})
