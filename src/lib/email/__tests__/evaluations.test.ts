import { describe, expect, it } from 'vitest'
import {
  canPublishAiPolicy,
  canPublishAutomaticPolicy,
  deterministicRepeatability,
  evaluateDeterministicFixtures,
  expandSeedFixtures,
  loadSeedFixtures,
  modelEvaluationUnavailable,
  visibleFixtureText,
} from '../ai/evaluations'
import { DETERMINISTIC_MODEL_ID } from '../ai/constants'

describe('AI evaluations', () => {
  it('blocks publication on a failed critical case', () => {
    expect(
      canPublishAiPolicy([{ id: '1', critical: true, passed: false } as never]),
    ).toBe(false)
    expect(
      canPublishAiPolicy([{ id: '1', critical: true, passed: true } as never]),
    ).toBe(true)
  })
  it('never treats a deterministic pass as automatic-mode permission', () => {
    const cases = evaluateDeterministicFixtures()
    expect(canPublishAiPolicy(cases)).toBe(true)
    expect(
      canPublishAutomaticPolicy({
        cases,
        modelBacked: false,
        allowedActions: ['acknowledge_interest'],
      }),
    ).toBe(false)
    expect(
      canPublishAutomaticPolicy({
        cases,
        modelBacked: false,
        allowedActions: [],
      }),
    ).toBe(true)
  })
  it('matches every bundled seed fixture without a model call', () => {
    const cases = evaluateDeterministicFixtures()
    expect(cases).toHaveLength(loadSeedFixtures().length)
    expect(cases.filter((c) => !c.passed).map((c) => c.id)).toEqual([])
  })
  it('keeps live model evaluation unavailable unless the deterministic runner is selected', () => {
    expect(modelEvaluationUnavailable('openai/gpt-5.6-luna')).toBe(true)
    expect(modelEvaluationUnavailable(DETERMINISTIC_MODEL_ID)).toBe(false)
    expect(deterministicRepeatability().modelBacked).toBe(false)
  })
  it('ignores quoted history when expanding practice fixtures', () => {
    expect(
      visibleFixtureText('> Call me at 816-555-9999\nYes, I would consider selling.'),
    ).toBe('Yes, I would consider selling.')
    const expanded = evaluateDeterministicFixtures(expandSeedFixtures())
    expect(expanded.length).toBe(loadSeedFixtures().length * 3)
    expect(expanded.filter((c) => !c.passed).map((c) => c.id)).toEqual([])
  })
})
