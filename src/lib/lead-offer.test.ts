import { describe, expect, it } from 'vitest'

import {
  nextStageAfterOffer,
  offerActivityDescription,
  parseLeadOfferInput,
} from './lead-offer'

describe('lead offer operating rules', () => {
  it('normalizes currency input and preserves the offer method', () => {
    expect(parseLeadOfferInput({ amount: '$112,500', method: 'written', notes: 'Sent by email' })).toEqual({
      success: true,
      data: { amount: 112_500, method: 'written', notes: 'Sent by email' },
    })
  })

  it('rejects incomplete or invalid offer records', () => {
    expect(parseLeadOfferInput({ amount: 0, method: 'verbal' })).toEqual({
      success: false,
      error: 'Enter a valid offer amount.',
    })
    expect(parseLeadOfferInput({ amount: 100_000, method: 'email' })).toEqual({
      success: false,
      error: 'Choose whether the offer was verbal or written.',
    })
  })

  it('advances active work to offer made without demoting later stages', () => {
    expect(nextStageAfterOffer('qualified')).toBe('offer_made')
    expect(nextStageAfterOffer('appointment_set')).toBe('offer_made')
    expect(nextStageAfterOffer('under_contract')).toBe('under_contract')
    expect(nextStageAfterOffer('closed_won')).toBe('closed_won')
    expect(nextStageAfterOffer('dead')).toBeNull()
  })

  it('creates a human-readable audit description', () => {
    expect(offerActivityDescription({ amount: 112_500, method: 'verbal', notes: null }))
      .toBe('Verbal offer made: $112,500')
  })
})
