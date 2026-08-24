import { describe, expect, it } from 'vitest'
import {
  buildPpcLeadCacheUpdates,
  derivePpcLeadIntelligence,
} from './lead-intelligence'

describe('canonical PPC lead intelligence', () => {
  it('derives typed lead updates from explicit seller answers', () => {
    const result = derivePpcLeadIntelligence({
      source: 'ppc_form_submit',
      formStatus: 'submitted',
      situation: 'condition',
      timeline: 'asap',
      condition: 'needs-work',
      auctionStatus: 'not-sure',
      county: 'jackson',
      state: 'mo',
    })

    expect(result).toEqual({
      sellerSituation: 'PPC intake: reason: Property condition is the issue; condition: Property needs work; timing: ASAP; auction status: not sure; county: Jackson, MO.',
      motivationScore: 10,
      changed: [],
    })
    expect(buildPpcLeadCacheUpdates(result)).toEqual({
      seller_situation: result.sellerSituation,
      motivation_score: 10,
    })
  })

  it('preserves redemption and excess-proceeds qualifiers in canonical text', () => {
    const redemption = derivePpcLeadIntelligence({
      formStatus: 'submitted',
      situation: 'redemption-window',
      timeline: 'asap',
      condition: 'redeem-title',
      auctionStatus: 'yes',
    })
    const proceeds = derivePpcLeadIntelligence({
      formStatus: 'submitted',
      situation: 'excess-proceeds',
      timeline: '60-days',
      condition: 'proceeds-heirs',
      auctionStatus: 'yes',
    })

    expect(redemption.sellerSituation).toContain('Tax-sale redemption window')
    expect(redemption.sellerSituation).toContain('Needs title help during redemption')
    expect(redemption.motivationScore).toBe(10)
    expect(proceeds.sellerSituation).toContain('Excess proceeds claim')
    expect(proceeds.sellerSituation).toContain('Multiple heirs or owners involved')
    expect(proceeds.motivationScore).toBe(10)
  })

  it('returns no fabricated situation when the seller supplied no evidence', () => {
    const result = derivePpcLeadIntelligence({})

    expect(result.sellerSituation).toBeNull()
    expect(result.motivationScore).toBe(4)
    expect(buildPpcLeadCacheUpdates(result)).toEqual({ motivation_score: 4 })
  })
})
