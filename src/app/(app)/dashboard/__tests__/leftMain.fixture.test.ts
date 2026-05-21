import { describe, expect, it } from 'vitest'

import { LEFT_MAIN_FIXTURE } from '../__fixtures__/leftMain'

describe('Left Main bottleneck fixture', () => {
  it('is a frozen canonical scenario with complete current and optimized data', () => {
    expect(Object.isFrozen(LEFT_MAIN_FIXTURE)).toBe(true)
    expect(LEFT_MAIN_FIXTURE.source).toBe('IMG_0713')

    for (const scenario of [LEFT_MAIN_FIXTURE.current, LEFT_MAIN_FIXTURE.optimized]) {
      expect(scenario.inputs.averageDealMargin).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(scenario.inputs.totalLeads)).toBe(true)
      expect(scenario.inputs.totalLeads).toBeGreaterThanOrEqual(0)

      expect(Object.keys(scenario.inputs.rates).sort()).toEqual([
        'assignmentToClosing',
        'contractToAssignment',
        'leadQualification',
        'opportunityToAppointment',
        'opportunityToContract',
      ])

      for (const rate of Object.values(scenario.inputs.rates)) {
        expect(Number.isFinite(rate)).toBe(true)
        expect(rate).toBeGreaterThanOrEqual(0)
        expect(rate).toBeLessThanOrEqual(1)
      }

      expect(Number.isFinite(scenario.expected.closedDeals)).toBe(true)
      expect(Number.isFinite(scenario.expected.grossRevenue)).toBe(true)
    }
  })
})
