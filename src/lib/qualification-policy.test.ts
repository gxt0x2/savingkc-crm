import { describe, expect, it } from 'vitest'
import { evaluateQualification, qualificationError } from './qualification-policy'

describe('evaluateQualification', () => {
  it('requires all four qualification pillars', () => {
    const status = evaluateQualification([
      { pillar: 'TIMELINE', evidence: 'Within 30 days', status: 'verified' },
      { pillar: 'CONDITION', evidence: 'Roof and kitchen need repair', status: 'verified' },
    ])

    expect(status.qualified).toBe(false)
    expect(status.missing).toEqual(['MOTIVATION', 'PRICE'])
    expect(qualificationError(status)).toContain('MOTIVATION, PRICE')
  })

  it('accepts all four human-verified pillars', () => {
    expect(evaluateQualification([
      { pillar: 'TIMELINE', evidence: 'Within 30 days', status: 'verified' },
      { pillar: 'CONDITION', evidence: 'Fair condition', status: 'verified' },
      { pillar: 'MOTIVATION', evidence: 'Inherited property', status: 'verified' },
      { pillar: 'PRICE', evidence: '$125,000 with flexibility', status: 'verified' },
    ])).toMatchObject({ qualified: true, missing: [] })
  })

  it('does not treat imported legacy evidence as verified CRM fact', () => {
    const status = evaluateQualification([
      { pillar: 'TIMELINE', evidence: 'Within 30 days', status: 'needs_review' },
      { pillar: 'CONDITION', evidence: 'Fair condition', status: 'needs_review' },
      { pillar: 'MOTIVATION', evidence: 'Inherited property', status: 'needs_review' },
      { pillar: 'PRICE', evidence: '$125,000', status: 'needs_review' },
    ])

    expect(status).toMatchObject({ qualified: false, missing: ['TIMELINE', 'CONDITION', 'MOTIVATION', 'PRICE'] })
  })
})
