import { describe, expect, it } from 'vitest'

import { calculateScenario, compareScenarios, validateInputs } from '../lib/bottleneck'
import type { ConversionStage, ScenarioInputs } from '../lib/bottleneck.types'
import {
  ALL_RATES_AT_0_SCENARIO,
  ALL_RATES_AT_100_SCENARIO,
  ZERO_LEADS_SCENARIO,
} from '../__fixtures__/edgeCases'
import { LEFT_MAIN_FIXTURE } from '../__fixtures__/leftMain'

const conversionStages: ConversionStage[] = [
  'leadQualification',
  'opportunityToAppointment',
  'opportunityToContract',
  'contractToAssignment',
  'assignmentToClosing',
]

function cloneInputs(inputs: ScenarioInputs): ScenarioInputs {
  return {
    averageDealMargin: inputs.averageDealMargin,
    totalLeads: inputs.totalLeads,
    rates: { ...inputs.rates },
  }
}

describe('calculateScenario', () => {
  it('matches the canonical IMG_0713 Left Main current state', () => {
    expect(calculateScenario(cloneInputs(LEFT_MAIN_FIXTURE.current.inputs))).toEqual(
      LEFT_MAIN_FIXTURE.current.expected,
    )
  })

  it('matches the canonical IMG_0713 Left Main optimized state', () => {
    expect(calculateScenario(cloneInputs(LEFT_MAIN_FIXTURE.optimized.inputs))).toEqual(
      LEFT_MAIN_FIXTURE.optimized.expected,
    )
  })

  it('returns zero counts, zero closed-won rate, and zero revenue when total leads is zero', () => {
    expect(calculateScenario(cloneInputs(ZERO_LEADS_SCENARIO))).toEqual({
      stageCounts: {
        leadQualification: 0,
        opportunityToAppointment: 0,
        opportunityToContract: 0,
        contractToAssignment: 0,
        assignmentToClosing: 0,
      },
      closedWonRate: 0,
      closedDeals: 0,
      grossRevenue: 0,
    })
  })

  it('returns zero revenue with non-zero closed deals when margin is zero', () => {
    const output = calculateScenario({
      ...cloneInputs(LEFT_MAIN_FIXTURE.current.inputs),
      averageDealMargin: 0,
    })

    expect(output.closedDeals).toBe(1.728)
    expect(output.grossRevenue).toBe(0)
  })

  it('returns total leads as closed deals when all rates are 100 percent', () => {
    const output = calculateScenario(cloneInputs(ALL_RATES_AT_100_SCENARIO))

    expect(output.closedDeals).toBe(ALL_RATES_AT_100_SCENARIO.totalLeads)
    expect(output.closedWonRate).toBe(1)
    expect(output.grossRevenue).toBe(1000000)
  })

  it('returns zero throughout when all rates are zero', () => {
    const output = calculateScenario(cloneInputs(ALL_RATES_AT_0_SCENARIO))

    expect(output.stageCounts).toEqual({
      leadQualification: 0,
      opportunityToAppointment: 0,
      opportunityToContract: 0,
      contractToAssignment: 0,
      assignmentToClosing: 0,
    })
    expect(output.closedDeals).toBe(0)
    expect(output.closedWonRate).toBe(0)
    expect(output.grossRevenue).toBe(0)
  })

  it('collapses the pipeline below a single zero rate', () => {
    const output = calculateScenario({
      averageDealMargin: 10000,
      totalLeads: 100,
      rates: {
        leadQualification: 0.5,
        opportunityToAppointment: 0.5,
        opportunityToContract: 0,
        contractToAssignment: 1,
        assignmentToClosing: 1,
      },
    })

    expect(output.stageCounts).toEqual({
      leadQualification: 50,
      opportunityToAppointment: 25,
      opportunityToContract: 0,
      contractToAssignment: 0,
      assignmentToClosing: 0,
    })
    expect(output.closedDeals).toBe(0)
    expect(output.grossRevenue).toBe(0)
  })

  it('normalizes floating point multiplication artifacts out of public outputs', () => {
    const output = calculateScenario({
      averageDealMargin: 1,
      totalLeads: 1,
      rates: {
        leadQualification: 0.1,
        opportunityToAppointment: 0.2,
        opportunityToContract: 0.3,
        contractToAssignment: 1,
        assignmentToClosing: 1,
      },
    })

    expect(output.stageCounts.opportunityToAppointment).toBe(0.02)
    expect(output.stageCounts.opportunityToContract).toBe(0.006)
    expect(output.closedDeals).toBe(0.006)
    expect(output.closedWonRate).toBe(0.006)
    expect(output.grossRevenue).toBe(0.006)
  })
})

describe('compareScenarios', () => {
  it('matches the canonical IMG_0713 Left Main comparison', () => {
    expect(
      compareScenarios(
        cloneInputs(LEFT_MAIN_FIXTURE.current.inputs),
        cloneInputs(LEFT_MAIN_FIXTURE.optimized.inputs),
      ),
    ).toEqual({
      current: LEFT_MAIN_FIXTURE.current.expected,
      optimized: LEFT_MAIN_FIXTURE.optimized.expected,
      rateIncreases: {
        leadQualification: 0.1,
        opportunityToAppointment: 0,
        opportunityToContract: 0,
        contractToAssignment: 0.2,
        assignmentToClosing: 0,
      },
      revenueIncreasePercent: LEFT_MAIN_FIXTURE.comparison.expected.revenueIncreasePercent,
      netIncrease: LEFT_MAIN_FIXTURE.comparison.expected.netIncrease,
      inputWarnings: [],
    })
  })

  it('returns zero delta for identical scenarios', () => {
    const comparison = compareScenarios(
      cloneInputs(LEFT_MAIN_FIXTURE.current.inputs),
      cloneInputs(LEFT_MAIN_FIXTURE.current.inputs),
    )

    expect(comparison.revenueIncreasePercent).toBe(0)
    expect(comparison.netIncrease).toBe(0)
    expect(Object.values(comparison.rateIncreases)).toEqual([0, 0, 0, 0, 0])
  })

  it('keeps a negative delta when the optimized scenario is worse', () => {
    const comparison = compareScenarios(
      cloneInputs(LEFT_MAIN_FIXTURE.optimized.inputs),
      cloneInputs(LEFT_MAIN_FIXTURE.current.inputs),
    )

    expect(comparison.netIncrease).toBe(-13440)
    expect(comparison.revenueIncreasePercent).toBeCloseTo(-43.75, 12)
  })

  it('computes comparison and flags when total leads or margin differ', () => {
    const comparison = compareScenarios(
      cloneInputs(LEFT_MAIN_FIXTURE.current.inputs),
      {
        ...cloneInputs(LEFT_MAIN_FIXTURE.optimized.inputs),
        averageDealMargin: 12000,
        totalLeads: 120,
      },
    )

    expect(comparison.netIncrease).toBe(26956.8)
    expect(comparison.revenueIncreasePercent).toBeCloseTo(156, 12)
    expect(comparison.inputWarnings).toEqual(['averageDealMarginChanged', 'totalLeadsChanged'])
  })

  it('uses a zero revenue increase percent when current revenue is zero', () => {
    const comparison = compareScenarios(
      cloneInputs(ALL_RATES_AT_0_SCENARIO),
      cloneInputs(LEFT_MAIN_FIXTURE.current.inputs),
    )

    expect(comparison.current.grossRevenue).toBe(0)
    expect(comparison.optimized.grossRevenue).toBe(17280)
    expect(comparison.revenueIncreasePercent).toBe(0)
    expect(comparison.netIncrease).toBe(17280)
  })
})

describe('validateInputs', () => {
  it('allows the canonical Left Main inputs', () => {
    expect(() => validateInputs(cloneInputs(LEFT_MAIN_FIXTURE.current.inputs))).not.toThrow()
  })

  it.each([
    ['undefined inputs', undefined],
    ['null inputs', null],
  ])('throws for %s', (_label, inputs) => {
    expect(() => validateInputs(inputs as unknown as ScenarioInputs)).toThrow()
  })

  it.each([
    ['negative margin', { averageDealMargin: -1 }],
    ['negative total leads', { totalLeads: -1 }],
    ['non-integer total leads', { totalLeads: 1.5 }],
  ])('throws for %s', (_label, patch) => {
    expect(() =>
      validateInputs({
        ...cloneInputs(LEFT_MAIN_FIXTURE.current.inputs),
        ...patch,
      }),
    ).toThrow()
  })

  it.each([
    ['rate greater than one', 1.01],
    ['rate less than zero', -0.01],
    ['NaN rate', Number.NaN],
    ['Infinity rate', Number.POSITIVE_INFINITY],
    ['undefined rate', undefined],
  ])('throws for %s', (_label, rate) => {
    const inputs = cloneInputs(LEFT_MAIN_FIXTURE.current.inputs)
    inputs.rates.leadQualification = rate as number

    expect(() => validateInputs(inputs)).toThrow()
  })

  it.each([
    ['NaN margin', { averageDealMargin: Number.NaN }],
    ['Infinity margin', { averageDealMargin: Number.POSITIVE_INFINITY }],
    ['undefined margin', { averageDealMargin: undefined }],
    ['NaN total leads', { totalLeads: Number.NaN }],
    ['Infinity total leads', { totalLeads: Number.POSITIVE_INFINITY }],
    ['undefined total leads', { totalLeads: undefined }],
  ])('throws for %s', (_label, patch) => {
    expect(() =>
      validateInputs({
        ...cloneInputs(LEFT_MAIN_FIXTURE.current.inputs),
        ...patch,
      } as ScenarioInputs),
    ).toThrow()
  })

  it.each([
    ['undefined rates', undefined],
    ['null rates', null],
  ])('throws for %s', (_label, rates) => {
    expect(() =>
      validateInputs({
        ...cloneInputs(LEFT_MAIN_FIXTURE.current.inputs),
        rates,
      } as unknown as ScenarioInputs),
    ).toThrow()
  })

  it('throws when a required conversion stage is missing', () => {
    const inputs = cloneInputs(LEFT_MAIN_FIXTURE.current.inputs)
    delete (inputs.rates as Partial<Record<ConversionStage, number>>).contractToAssignment

    expect(() => validateInputs(inputs)).toThrow()
  })

  it('throws when rates has an unknown conversion stage', () => {
    const inputs = cloneInputs(LEFT_MAIN_FIXTURE.current.inputs) as ScenarioInputs & {
      rates: ScenarioInputs['rates'] & { staleStage?: number }
    }
    inputs.rates.staleStage = 0.5

    expect(() => validateInputs(inputs)).toThrow()
  })

  it.each(conversionStages)('calculateScenario validates %s before calculating', (stage) => {
    const inputs = cloneInputs(LEFT_MAIN_FIXTURE.current.inputs)
    inputs.rates[stage] = -1

    expect(() => calculateScenario(inputs)).toThrow()
  })

  it('compareScenarios validates both scenarios before comparing', () => {
    const optimized = cloneInputs(LEFT_MAIN_FIXTURE.optimized.inputs)
    optimized.totalLeads = -1

    expect(() =>
      compareScenarios(cloneInputs(LEFT_MAIN_FIXTURE.current.inputs), optimized),
    ).toThrow()
  })
})
