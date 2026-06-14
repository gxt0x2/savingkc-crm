import { describe, expect, it, vi } from 'vitest'
import { isInternalTestPhone } from './internal-test-phones'

describe('internal-test-phones', () => {
  it('recognizes the Google Voice test number', () => {
    expect(isInternalTestPhone('(913) 717-9617')).toBe(true)
    expect(isInternalTestPhone('+19137179617')).toBe(true)
    expect(isInternalTestPhone('+19137179716')).toBe(true)
    expect(isInternalTestPhone('(816) 553-7559')).toBe(true)
    expect(isInternalTestPhone('+18165537559')).toBe(true)
    expect(isInternalTestPhone('+18166088808')).toBe(false)
  })

  it('supports configured internal test phones', () => {
    vi.stubEnv('PPC_INTERNAL_TEST_PHONES', '+18165550123')
    expect(isInternalTestPhone('816-555-0123')).toBe(true)
  })
})
