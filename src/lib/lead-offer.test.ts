import { describe, expect, it } from 'vitest'

import { parseLeadOfferInput } from './lead-offer'

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
})
