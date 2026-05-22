import {
  CONVERSION_STAGES,
  type ConversionStage,
  type ScenarioComparison,
  type ScenarioComparisonWarning,
  type ScenarioInputs,
  type ScenarioOutputs,
} from './bottleneck.types'

const STAGE_SET = new Set<string>(CONVERSION_STAGES)

export function validateInputs(inputs: ScenarioInputs): void {
  if (!inputs || typeof inputs !== 'object') {
    throw new Error('Scenario inputs must be an object.')
  }

  assertFiniteNumber(inputs.averageDealMargin, 'averageDealMargin')
  assertFiniteNumber(inputs.totalLeads, 'totalLeads')

  if (inputs.averageDealMargin < 0) {
    throw new Error('averageDealMargin must be greater than or equal to 0.')
  }

  if (!Number.isInteger(inputs.totalLeads)) {
    throw new Error('totalLeads must be an integer.')
  }

  if (inputs.totalLeads < 0) {
    throw new Error('totalLeads must be greater than or equal to 0.')
  }

  if (!inputs.rates || typeof inputs.rates !== 'object') {
    throw new Error('rates must be an object.')
  }

  const rateKeys = Object.keys(inputs.rates)

  for (const stage of CONVERSION_STAGES) {
    if (!Object.prototype.hasOwnProperty.call(inputs.rates, stage)) {
      throw new Error(`Missing rate for ${stage}.`)
    }
  }

  for (const key of rateKeys) {
    if (!STAGE_SET.has(key)) {
      throw new Error(`Unknown conversion stage: ${key}.`)
    }
  }

  for (const stage of CONVERSION_STAGES) {
    const rate = inputs.rates[stage]
    assertFiniteNumber(rate, `rates.${stage}`)

    if (rate < 0 || rate > 1) {
      throw new Error(`rates.${stage} must be between 0 and 1.`)
    }
  }
}

export function calculateScenario(inputs: ScenarioInputs): ScenarioOutputs {
  validateInputs(inputs)

  const stageCounts = {} as Record<ConversionStage, number>
  let runningCount = inputs.totalLeads

  for (const stage of CONVERSION_STAGES) {
    runningCount *= inputs.rates[stage]
    stageCounts[stage] = normalizeNumber(runningCount)
  }

  const closedDeals = normalizeNumber(runningCount)
  const closedWonRate = inputs.totalLeads === 0 ? 0 : normalizeNumber(calculateRateProduct(inputs))
  const grossRevenue = normalizeNumber(runningCount * inputs.averageDealMargin)

  return {
    stageCounts,
    closedWonRate,
    closedDeals,
    grossRevenue,
  }
}

export function compareScenarios(current: ScenarioInputs, optimized: ScenarioInputs): ScenarioComparison {
  validateInputs(current)
  validateInputs(optimized)

  const currentOutputs = calculateScenario(current)
  const optimizedOutputs = calculateScenario(optimized)
  const netIncrease = normalizeNumber(optimizedOutputs.grossRevenue - currentOutputs.grossRevenue)
  const revenueIncreasePercent =
    currentOutputs.grossRevenue === 0 ? 0 : (netIncrease / currentOutputs.grossRevenue) * 100

  return {
    current: currentOutputs,
    optimized: optimizedOutputs,
    rateIncreases: calculateRateIncreases(current, optimized),
    revenueIncreasePercent,
    netIncrease,
    inputWarnings: getInputWarnings(current, optimized),
  }
}

function calculateRateIncreases(
  current: ScenarioInputs,
  optimized: ScenarioInputs,
): Record<ConversionStage, number> {
  const rateIncreases = {} as Record<ConversionStage, number>

  for (const stage of CONVERSION_STAGES) {
    rateIncreases[stage] = normalizeNumber(optimized.rates[stage] - current.rates[stage])
  }

  return rateIncreases
}

function calculateRateProduct(inputs: ScenarioInputs): number {
  return CONVERSION_STAGES.reduce((product, stage) => product * inputs.rates[stage], 1)
}

function getInputWarnings(
  current: ScenarioInputs,
  optimized: ScenarioInputs,
): ScenarioComparisonWarning[] {
  const warnings: ScenarioComparisonWarning[] = []

  if (current.averageDealMargin !== optimized.averageDealMargin) {
    warnings.push('averageDealMarginChanged')
  }

  if (current.totalLeads !== optimized.totalLeads) {
    warnings.push('totalLeadsChanged')
  }

  return warnings
}

function assertFiniteNumber(value: unknown, fieldName: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number.`)
  }
}

function normalizeNumber(value: number): number {
  return Number(value.toPrecision(14))
}
