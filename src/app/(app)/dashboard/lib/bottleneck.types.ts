export const CONVERSION_STAGES = [
  'leadQualification',
  'opportunityToAppointment',
  'opportunityToContract',
  'contractToAssignment',
  'assignmentToClosing',
] as const

export type ConversionStage = (typeof CONVERSION_STAGES)[number]

export interface ScenarioInputs {
  averageDealMargin: number
  totalLeads: number
  rates: Record<ConversionStage, number>
}

export interface ScenarioOutputs {
  stageCounts: Record<ConversionStage, number>
  closedWonRate: number
  closedDeals: number
  grossRevenue: number
}

export type ScenarioComparisonWarning = 'averageDealMarginChanged' | 'totalLeadsChanged'

export interface ScenarioComparison {
  current: ScenarioOutputs
  optimized: ScenarioOutputs
  rateIncreases: Record<ConversionStage, number>
  revenueIncreasePercent: number
  netIncrease: number
  inputWarnings: ScenarioComparisonWarning[]
}
