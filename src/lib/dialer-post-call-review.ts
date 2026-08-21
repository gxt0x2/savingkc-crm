import type { CallAnalysisResult } from '@/lib/mojo-call-analyzer'
import type { AiChangeProposal } from '@/lib/ai-change-proposal'

export type DialerPostCallStatus = 'not_requested' | 'processing' | 'ready' | 'unavailable' | 'skipped'

export interface DialerPostCallReview {
  status: DialerPostCallStatus
  summary: string | null
  sentiment: string | null
  motivationScore: number | null
  nextAction: string | null
  nextActionAt: string | null
  strengths: string[]
  improvements: string[]
  recordingSid: string | null
  providerCallSid: string | null
  completedAt: string | null
  updatedAt: string | null
  failureCode: string | null
  changeProposal: AiChangeProposal | null
}

export type DialerPostCallRow = {
  post_call_status?: unknown
  post_call_summary?: unknown
  post_call_snapshot?: unknown
  post_call_completed_at?: unknown
  post_call_updated_at?: unknown
  recording_sid?: unknown
  provider_call_sid?: unknown
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const normalized = text(item)
    return normalized ? [normalized] : []
  }).slice(0, 5)
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function postCallSnapshot(analysis: CallAnalysisResult): Record<string, unknown> {
  return {
    sentiment: text(analysis.sentiment),
    motivationScore: number(analysis.motivationScore),
    nextAction: text(analysis.followUpAction) || stringList(analysis.nextSteps)[0] || null,
    nextActionAt: text(analysis.followUpDateTime),
    strengths: stringList(analysis.agentStrengths),
    improvements: stringList(analysis.agentImprovements),
  }
}

export function parseDialerPostCallReview(row: DialerPostCallRow, changeProposal: AiChangeProposal | null = null): DialerPostCallReview {
  const status = text(row.post_call_status)
  const snapshot = object(row.post_call_snapshot)
  return {
    status: ['not_requested', 'processing', 'ready', 'unavailable', 'skipped'].includes(status || '')
      ? status as DialerPostCallStatus
      : 'not_requested',
    summary: text(row.post_call_summary),
    sentiment: text(snapshot.sentiment),
    motivationScore: number(snapshot.motivationScore),
    nextAction: text(snapshot.nextAction),
    nextActionAt: text(snapshot.nextActionAt),
    strengths: stringList(snapshot.strengths),
    improvements: stringList(snapshot.improvements),
    recordingSid: text(row.recording_sid),
    providerCallSid: text(row.provider_call_sid),
    completedAt: text(row.post_call_completed_at),
    updatedAt: text(row.post_call_updated_at),
    failureCode: text(snapshot.failureCode),
    changeProposal,
  }
}
