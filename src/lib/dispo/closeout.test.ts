import { describe, expect, it } from 'vitest'
import {
  buildFundingMetrics,
  nextBusinessDayDueAt,
  validateDebrief,
  validateFundingCloseout,
  type DebriefInput,
  type FundingCloseoutInput,
} from './closeout'

const funding: FundingCloseoutInput = {
  fundedAt: '2026-07-31T15:00:00.000Z',
  finalAssignmentFee: 24_500,
  closingCosts: 1_250,
  sellerPurchasePrice: 100_000,
  buyerPurchasePrice: 124_500,
  settlementStatementVerified: true,
  fundingConfirmed: true,
  notes: null,
  recordedBy: 'Ernest',
}

describe('disposition close-out operating model', () => {
  it('schedules a Friday funding debrief for the next business day', () => {
    expect(nextBusinessDayDueAt('2026-07-31T15:00:00.000Z')).toBe('2026-08-03T15:00:00.000Z')
  })

  it('calculates revenue and cycle-time metrics from the confirmed close', () => {
    expect(buildFundingMetrics(funding, {
      enteredAt: '2026-07-20T15:00:00.000Z',
      leadCreatedAt: '2026-07-01T15:00:00.000Z',
    })).toEqual({
      grossRevenue: 24_500,
      closingCosts: 1_250,
      netRevenue: 23_250,
      transactionSpread: 24_500,
      dispositionDays: 11,
      leadToCloseDays: 30,
    })
  })

  it('will not close a transaction without funding and settlement confirmation', () => {
    expect(validateFundingCloseout({
      ...funding,
      fundingConfirmed: false,
      settlementStatementVerified: false,
    })).toEqual(['Funding must be confirmed', 'Settlement statement must be verified'])
  })

  it('requires a useful debrief before archive', () => {
    const incomplete: DebriefInput = {
      outcomeRating: 5,
      buyerPerformance: 4,
      sourceQuality: 4,
      wentWell: '',
      friction: '',
      lesson: '',
      processChange: '',
      completedBy: 'Ernest',
    }
    expect(validateDebrief(incomplete)).toHaveLength(4)
  })
})
