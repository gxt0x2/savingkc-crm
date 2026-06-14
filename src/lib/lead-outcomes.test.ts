import { describe, expect, it } from 'vitest'
import { cleanDeadReason, deadReasonLabel, isValidDeadReason } from './lead-outcomes'

describe('lead outcome dead reasons', () => {
  it('accepts business-wide dead reason ids', () => {
    expect(isValidDeadReason('dnc')).toBe(true)
    expect(isValidDeadReason('spam')).toBe(true)
    expect(isValidDeadReason('went_with_someone_else')).toBe(true)
    expect(isValidDeadReason('offer_too_low')).toBe(true)
  })

  it('cleans only known reasons', () => {
    expect(cleanDeadReason(' DNC ')).toBe('dnc')
    expect(cleanDeadReason('unknown')).toBeNull()
    expect(cleanDeadReason(null)).toBeNull()
  })

  it('labels stored reasons for activity and audit trails', () => {
    expect(deadReasonLabel('offer_too_low')).toBe('Offer too low')
    expect(deadReasonLabel('legacy_reason')).toBe('Legacy Reason')
  })
})
