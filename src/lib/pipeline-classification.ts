export const PIPELINE_CLASSIFICATION = {
  opportunity: {
    label: 'Real Opportunity',
    station: 'qualified',
    priority: 'hot',
    score: 85,
  },
  lead: {
    label: 'Lead',
    station: 'contacted',
    priority: 'warm',
    score: 55,
  },
  dead: {
    label: 'Dead',
    station: 'dead',
    priority: 'cold',
    score: 0,
  },
} as const

export type PipelineClassification = keyof typeof PIPELINE_CLASSIFICATION

export function isPipelineClassification(value: unknown): value is PipelineClassification {
  return typeof value === 'string' && value in PIPELINE_CLASSIFICATION
}
