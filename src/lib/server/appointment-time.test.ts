import { describe, expect, it } from 'vitest'
import { centralSlotDateTime } from './appointment-time'

describe('Central appointment slot timestamps', () => {
  it('uses standard time before the spring transition', () => {
    expect(centralSlotDateTime('2026-03-07', '10:00:00')).toBe('2026-03-07T10:00:00-06:00')
  })

  it('uses daylight time after the spring transition', () => {
    expect(centralSlotDateTime('2026-03-09', '10:00:00')).toBe('2026-03-09T10:00:00-05:00')
  })

  it('returns to standard time after the fall transition', () => {
    expect(centralSlotDateTime('2026-11-02', '10:00:00')).toBe('2026-11-02T10:00:00-06:00')
  })
})
