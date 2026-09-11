import { describe, expect, it } from 'vitest'

import { isSavingKcWorkday, savingKcHoliday } from './company-calendar'

describe('SavingKC company calendar', () => {
  it('marks Labor Day as a company holiday every year', () => {
    expect(savingKcHoliday('2026-09-07')).toEqual({ name: 'Labor Day', date: '2026-09-07' })
    expect(savingKcHoliday('2027-09-06')).toEqual({ name: 'Labor Day', date: '2027-09-06' })
    expect(isSavingKcWorkday('2026-09-07')).toBe(false)
  })

  it('keeps adjacent weekdays active and weekends closed', () => {
    expect(isSavingKcWorkday('2026-09-08')).toBe(true)
    expect(isSavingKcWorkday('2026-09-12')).toBe(false)
  })
})
