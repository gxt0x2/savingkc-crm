import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { calculateScenario } from '../lib/bottleneck'
import type { ScenarioInputs } from '../lib/bottleneck.types'

const runCount = 1000

const rateArbitrary = fc.integer({ min: 0, max: 1000000 }).map((value) => value / 1000000)

const ratesArbitrary = fc.record({
  leadQualification: rateArbitrary,
  opportunityToAppointment: rateArbitrary,
  opportunityToContract: rateArbitrary,
  contractToAssignment: rateArbitrary,
  assignmentToClosing: rateArbitrary,
})

const scenarioArbitrary: fc.Arbitrary<ScenarioInputs> = fc.record({
  averageDealMargin: fc.integer({ min: 0, max: 1000000 }),
  totalLeads: fc.integer({ min: 0, max: 1000000 }),
  rates: ratesArbitrary,
})

const positiveLeadScenarioArbitrary: fc.Arbitrary<ScenarioInputs> = fc.record({
  averageDealMargin: fc.integer({ min: 0, max: 1000000 }),
  totalLeads: fc.integer({ min: 1, max: 1000000 }),
  rates: ratesArbitrary,
})

describe('bottleneck property tests', () => {
  it('never closes more deals than total leads', () => {
    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const output = calculateScenario(scenario)

        expect(output.closedDeals).toBeLessThanOrEqual(scenario.totalLeads)
      }),
      { numRuns: runCount },
    )
  })

  it('never returns negative gross revenue when margin is non-negative', () => {
    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const output = calculateScenario(scenario)

        expect(output.grossRevenue).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: runCount },
    )
  })

  it('keeps pipeline stage counts monotonically non-increasing', () => {
    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const output = calculateScenario(scenario)
        const counts = [
          scenario.totalLeads,
          output.stageCounts.leadQualification,
          output.stageCounts.opportunityToAppointment,
          output.stageCounts.opportunityToContract,
          output.stageCounts.contractToAssignment,
          output.stageCounts.assignmentToClosing,
        ]

        for (let index = 1; index < counts.length; index += 1) {
          expect(counts[index]).toBeLessThanOrEqual(counts[index - 1])
        }
      }),
      { numRuns: runCount },
    )
  })

  it('sets closed-won rate to the product of all rates when leads are present', () => {
    fc.assert(
      fc.property(positiveLeadScenarioArbitrary, (scenario) => {
        const output = calculateScenario(scenario)
        const expectedRate =
          scenario.rates.leadQualification *
          scenario.rates.opportunityToAppointment *
          scenario.rates.opportunityToContract *
          scenario.rates.contractToAssignment *
          scenario.rates.assignmentToClosing

        expectCloseInvariant(output.closedWonRate, expectedRate)
      }),
      { numRuns: runCount },
    )
  })

  it('doubling total leads doubles closed deals and gross revenue', () => {
    fc.assert(
      fc.property(
        fc.record({
          averageDealMargin: fc.integer({ min: 0, max: 1000000 }),
          totalLeads: fc.integer({ min: 0, max: 500000 }),
          rates: ratesArbitrary,
        }),
        (scenario) => {
          const output = calculateScenario(scenario)
          const doubledOutput = calculateScenario({
            ...scenario,
            totalLeads: scenario.totalLeads * 2,
          })

          expectCloseInvariant(doubledOutput.closedDeals, output.closedDeals * 2)
          expectCloseInvariant(doubledOutput.grossRevenue, output.grossRevenue * 2)
        },
      ),
      { numRuns: runCount },
    )
  })

  it('doubling margin doubles gross revenue and leaves closed deals unchanged', () => {
    fc.assert(
      fc.property(
        fc.record({
          averageDealMargin: fc.integer({ min: 0, max: 500000 }),
          totalLeads: fc.integer({ min: 0, max: 1000000 }),
          rates: ratesArbitrary,
        }),
        (scenario) => {
          const output = calculateScenario(scenario)
          const doubledOutput = calculateScenario({
            ...scenario,
            averageDealMargin: scenario.averageDealMargin * 2,
          })

          expectCloseInvariant(doubledOutput.closedDeals, output.closedDeals)
          expectCloseInvariant(doubledOutput.grossRevenue, output.grossRevenue * 2)
        },
      ),
      { numRuns: runCount },
    )
  })
})

function expectCloseInvariant(actual: number, expected: number) {
  const tolerance = Math.max(1e-12, Math.abs(expected) * 1e-12)

  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}
