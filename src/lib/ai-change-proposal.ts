import type { CallAnalysisResult } from '@/lib/mojo-call-analyzer'

export type AiChangeProposalStatus = 'proposed' | 'applied' | 'rejected' | 'conflict'
export type AiLeadField = 'motivation_score' | 'property_condition' | 'asking_price' | 'opportunity_score' | 'classification'

export interface AiChangeItem {
  field: AiLeadField
  label: string
  before: string | number | null
  proposed: string | number
}

export interface AiChangeProposal {
  id: string
  status: AiChangeProposalStatus
  summary: string
  changes: AiChangeItem[]
  decidedBy: string | null
  decisionNote: string | null
  decidedAt: string | null
  appliedAt: string | null
  errorCode: string | null
}

export interface AiChangeProposalRow {
  id?: unknown
  status?: unknown
  summary?: unknown
  proposed_changes?: unknown
  base_snapshot?: unknown
  decided_by?: unknown
  decision_note?: unknown
  decided_at?: unknown
  applied_at?: unknown
  error_code?: unknown
}

const FIELD_LABELS: Record<AiLeadField, string> = {
  motivation_score: 'Motivation score',
  property_condition: 'Property condition',
  asking_price: 'Seller asking price',
  opportunity_score: 'Opportunity score',
  classification: 'Lead classification',
}

const ALLOWED_FIELDS = Object.keys(FIELD_LABELS) as AiLeadField[]
const CONDITIONS = new Set(['excellent', 'good', 'fair', 'poor', 'uninhabitable'])
const CLASSIFICATIONS = new Set(['opportunity', 'lead'])

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function finiteInteger(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null
}

function finiteNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
}

export function buildCallAnalysisLeadChanges(
  analysis: CallAnalysisResult,
  current: Record<AiLeadField, string | number | null>,
): { proposedChanges: Record<string, string | number>; baseSnapshot: Record<string, string | number | null> } | null {
  const candidates: Partial<Record<AiLeadField, string | number>> = {}
  const motivation = finiteInteger(analysis.motivationScore, 1, 10)
  const condition = text(analysis.conditionOverall)?.toLowerCase() || null
  const asking = finiteNumber(analysis.sellerAsking, 1, 100_000_000)
  const opportunity = finiteInteger(analysis.opportunity_score, 0, 100)
  const classification = text(analysis.classification)?.toLowerCase() || null

  if (motivation != null) candidates.motivation_score = motivation
  if (condition && CONDITIONS.has(condition)) candidates.property_condition = condition
  if (asking != null) candidates.asking_price = asking
  if (opportunity != null) candidates.opportunity_score = opportunity
  if (classification && CLASSIFICATIONS.has(classification)) candidates.classification = classification

  const proposedChanges: Record<string, string | number> = {}
  const baseSnapshot: Record<string, string | number | null> = {}
  for (const field of ALLOWED_FIELDS) {
    const proposed = candidates[field]
    if (proposed === undefined || proposed === current[field]) continue
    proposedChanges[field] = proposed
    baseSnapshot[field] = current[field]
  }
  return Object.keys(proposedChanges).length ? { proposedChanges, baseSnapshot } : null
}

export function parseAiChangeProposal(value: unknown): AiChangeProposal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as AiChangeProposalRow
  const id = text(row.id)
  const status = text(row.status)
  const summary = text(row.summary)
  if (!id || !summary || !status || !['proposed', 'applied', 'rejected', 'conflict'].includes(status)) return null
  const proposed = object(row.proposed_changes)
  const before = object(row.base_snapshot)
  const changes = ALLOWED_FIELDS.flatMap((field) => {
    const next = proposed[field]
    if (typeof next !== 'string' && typeof next !== 'number') return []
    const prior = before[field]
    return [{
      field,
      label: FIELD_LABELS[field],
      before: typeof prior === 'string' || typeof prior === 'number' ? prior : null,
      proposed: next,
    } satisfies AiChangeItem]
  })
  if (!changes.length) return null
  return {
    id,
    status: status as AiChangeProposalStatus,
    summary,
    changes,
    decidedBy: text(row.decided_by),
    decisionNote: text(row.decision_note),
    decidedAt: text(row.decided_at),
    appliedAt: text(row.applied_at),
    errorCode: text(row.error_code),
  }
}
