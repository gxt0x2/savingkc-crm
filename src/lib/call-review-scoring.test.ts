import { describe, expect, it } from 'vitest'

import { getCallReviewFramework } from './call-review-frameworks'
import { scoreCallReview, scorecardCalibrationStatus } from './call-review-scoring'

const framework = getCallReviewFramework('junior_acquisitions')!

function answersAt(value: number) {
  return Object.fromEntries(framework.sections.flatMap((section) => section.items.map((item) => [item.id, value])))
}

describe('weighted call review scoring', () => {
  it('gives motivation more influence than introduction regardless of item count', () => {
    const motivationMissed = answersAt(3)
    framework.sections.find((section) => section.label === 'Motivation / Discovery')?.items.forEach((item) => { motivationMissed[item.id] = 0 })
    const introductionMissed = answersAt(3)
    framework.sections.find((section) => section.label === 'Introduction')?.items.forEach((item) => { introductionMissed[item.id] = 0 })

    expect(scoreCallReview(framework, motivationMissed).score).toBeLessThan(scoreCallReview(framework, introductionMissed).score)
    expect(scoreCallReview(framework, motivationMissed).score).toBe(2.25)
    expect(scoreCallReview(framework, introductionMissed).score).toBe(2.85)
  })

  it('flags missed critical discovery and caps two or more misses', () => {
    const answers = answersAt(3)
    answers.why_now = 0
    answers.timeline = 0
    const result = scoreCallReview(framework, answers)

    expect(result.needsCoaching).toBe(true)
    expect(result.score).toBe(1.5)
    expect(result.coachingReasons).toEqual(['Motivation was not demonstrated', 'Timeline was not demonstrated'])
  })

  it('triggers recalibration at 25 completed human reviews', () => {
    expect(scorecardCalibrationStatus(24)).toMatchObject({ due: false, remaining: 1 })
    expect(scorecardCalibrationStatus(25)).toMatchObject({ due: true, remaining: 0 })
    expect(scorecardCalibrationStatus(30)).toMatchObject({ due: true, remaining: 0 })
  })
})
