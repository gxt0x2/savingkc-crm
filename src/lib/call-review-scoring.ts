import type { CallReviewFramework } from '@/lib/call-review-frameworks'

export const CALL_SCORECARD_SCORING_VERSION = 'jr-acquisitions-weighted-v1'
export const CALL_SCORECARD_RECALIBRATION_INTERVAL = 25

const JR_ACQUISITIONS_SECTION_WEIGHTS: Record<string, number> = {
  'Introduction': 0.05,
  'Motivation / Discovery': 0.25,
  'Property Condition': 0.10,
  'Timeline & Price': 0.20,
  'Decision Process': 0.20,
  'Summary & Solution': 0.10,
  'Appointment Setting': 0.10,
}

const CRITICAL_ITEMS = [
  { id: 'why_now', label: 'Motivation' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'decision_makers', label: 'Decision makers' },
  { id: 'next_step', label: 'Committed next step' },
] as const

const CRITICAL_SECTIONS = new Set(['Motivation / Discovery', 'Timeline & Price', 'Decision Process'])

function roundScore(value: number) {
  return Math.round(value * 100) / 100
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

export function scoreCallReview(framework: CallReviewFramework, answers: Record<string, number>) {
  const configuredWeights = framework.id === 'junior_acquisitions' ? JR_ACQUISITIONS_SECTION_WEIGHTS : null
  const fallbackWeight = 1 / Math.max(framework.sections.length, 1)
  const sectionScores = Object.fromEntries(framework.sections.map((section) => [
    section.label,
    roundScore(average(section.items.map((item) => answers[item.id] ?? 0))),
  ]))

  let score = framework.sections.reduce((sum, section) => {
    const weight = configuredWeights?.[section.label] ?? fallbackWeight
    return sum + sectionScores[section.label] * weight
  }, 0)

  const missedCritical = framework.id === 'junior_acquisitions'
    ? CRITICAL_ITEMS.filter((item) => (answers[item.id] ?? 0) === 0)
    : []
  if (missedCritical.length >= 2) score = Math.min(score, 1.5)

  const criticalSectionScores = framework.sections
    .filter((section) => CRITICAL_SECTIONS.has(section.label))
    .map((section) => sectionScores[section.label])

  return {
    score: roundScore(score),
    criticalScore: criticalSectionScores.length ? roundScore(average(criticalSectionScores)) : null,
    sectionScores,
    needsCoaching: missedCritical.length > 0,
    coachingReasons: missedCritical.map((item) => `${item.label} was not demonstrated`),
    scoringVersion: framework.id === 'junior_acquisitions' ? CALL_SCORECARD_SCORING_VERSION : `${framework.id}-equal-v1`,
  }
}

export function scorecardCalibrationStatus(completedOnCurrentVersion: number) {
  const completed = Math.max(0, Math.floor(completedOnCurrentVersion))
  return {
    completed,
    target: CALL_SCORECARD_RECALIBRATION_INTERVAL,
    due: completed >= CALL_SCORECARD_RECALIBRATION_INTERVAL,
    remaining: Math.max(0, CALL_SCORECARD_RECALIBRATION_INTERVAL - completed),
  }
}
