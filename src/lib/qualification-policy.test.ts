import { describe, expect, it } from 'vitest'
import { evaluateQualification, qualificationError } from './qualification-policy'

describe('evaluateQualification', () => {
  it('requires all four qualification pillars', () => {
    const status = evaluateQualification({
      lead: { four_pillars: { TIMELINE: true, CONDITION: true } },
    })

    expect(status.qualified).toBe(false)
    expect(status.missing).toEqual(['MOTIVATION', 'PRICE'])
    expect(qualificationError(status)).toContain('MOTIVATION, PRICE')
  })

  it('accepts explicit pillar evidence collected by a qualification workflow', () => {
    expect(evaluateQualification({
      activityMetadata: [{ TIMELINE: true, CONDITION: true, MOTIVATION: true, PRICE: true }],
    })).toMatchObject({ qualified: true, missing: [] })
  })

  it('recognizes structured manifest evidence without treating empty scaffolding as evidence', () => {
    const incomplete = evaluateQualification({
      manifest: {
        situation: { timeline: {}, motivation: {}, priceExpectations: {} },
        property: { condition: {} },
      },
    })
    expect(incomplete.qualified).toBe(false)

    const complete = evaluateQualification({
      manifest: {
        situation: {
          timeline: { preferredClosing: 'Within 30 days' },
          motivation: { primary: 'Inherited property' },
          priceExpectations: { priceFlexibility: 'medium' },
        },
        property: { condition: { overall: 'fair' } },
      },
    })
    expect(complete).toMatchObject({ qualified: true, missing: [] })
  })
})
