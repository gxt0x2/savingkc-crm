import { describe, expect, it } from 'vitest'
import {
  evaluateQualification,
  leadRevisionFromUpdatedAt,
} from '../../qualification-policy-core'
import { pilotOperatingDeadline } from '../workflow/schedule'

describe('email handoff policy helpers', () => {
  it('uses the same four-pillar rule as CRM qualification', () => {
    expect(
      evaluateQualification([
        { pillar: 'TIMELINE', evidence: '30 days', status: 'verified' },
        { pillar: 'CONDITION', evidence: 'Fair', status: 'verified' },
        { pillar: 'MOTIVATION', evidence: 'Inherited', status: 'verified' },
        { pillar: 'PRICE', evidence: '$100,000', status: 'needs_review' },
      ]).qualified,
    ).toBe(false)
    expect(
      evaluateQualification([
        { pillar: 'TIMELINE', evidence: '30 days', status: 'verified' },
        { pillar: 'CONDITION', evidence: 'Fair', status: 'verified' },
        { pillar: 'MOTIVATION', evidence: 'Inherited', status: 'verified' },
        { pillar: 'PRICE', evidence: '$100,000', status: 'verified' },
      ]).qualified,
    ).toBe(true)
  })

  it('treats the Lead updated clock as the current revision token', () => {
    expect(leadRevisionFromUpdatedAt('2026-09-14T15:00:00.000Z')).toBe(
      Date.parse('2026-09-14T15:00:00.000Z'),
    )
    expect(leadRevisionFromUpdatedAt(null)).toBeNull()
  })

  it('escalates acknowledgment after five Chicago operating minutes', () => {
    const start = new Date('2026-09-14T15:00:00.000Z')
    expect(pilotOperatingDeadline(start, 5).toISOString()).toBe(
      '2026-09-14T15:05:00.000Z',
    )
  })
})
