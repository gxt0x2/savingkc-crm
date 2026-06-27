import { describe, expect, it } from 'vitest'
import { paidClickCount } from './paid-click-count'

describe('paidClickCount', () => {
  it('uses imported ad platform clicks when they exist', () => {
    expect(paidClickCount(9, 19)).toBe(9)
  })

  it('falls back to first-party click ids when platform reporting is empty', () => {
    expect(paidClickCount(0, 7)).toBe(7)
  })
})
