import { createHash } from 'crypto'
import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  buildCallAnalysisLeadChanges,
  parseAiChangeProposal,
  type AiChangeProposal,
  type AiLeadField,
} from '@/lib/ai-change-proposal'
import { MOJO_CALL_ANALYZER_MODEL, type CallAnalysisResult } from '@/lib/mojo-call-analyzer'
import { DialerSessionError, getDialerSession } from '@/lib/server/dialer-session-engine'
import { supabase } from '@/lib/supabase-lazy'

const PROPOSAL_SELECT = 'id,status,summary,proposed_changes,base_snapshot,decided_by,decision_note,decided_at,applied_at,error_code'
const LEAD_FIELDS = 'station,motivation_score,property_condition,asking_price,opportunity_score,classification'

function errorText(error: { message?: string; code?: string } | null | undefined): string {
  return `${error?.message || ''} ${error?.code || ''}`.toLowerCase()
}

function proposalError(error: { message?: string; code?: string } | null | undefined): DialerSessionError {
  const raw = errorText(error)
  if (raw.includes('not_found')) return new DialerSessionError('ai_change_proposal_not_found', 404, 'AI change proposal not found')
  if (raw.includes('already_decided')) return new DialerSessionError('ai_change_proposal_already_decided', 409, 'These AI changes were already reviewed')
  if (raw.includes('invalid_')) return new DialerSessionError('invalid_ai_change_decision', 400, 'The AI change decision is invalid')
  return new DialerSessionError('ai_change_proposal_unavailable', 503, 'AI change review is unavailable')
}

export async function getAiChangeProposalForAttemptId(attemptId: string): Promise<AiChangeProposal | null> {
  const { data, error } = await supabase
    .from('ai_change_proposals')
    .select(PROPOSAL_SELECT)
    .eq('dialer_session_attempt_id', attemptId)
    .maybeSingle()
  if (error) throw proposalError(error)
  return parseAiChangeProposal(data)
}

export async function createCallAnalysisLeadProposal(input: {
  leadId: string
  clientAttemptId: string | null
  recordingSid: string
  analysis: CallAnalysisResult
}): Promise<AiChangeProposal | null> {
  let attemptId: string | null = null
  if (input.clientAttemptId?.trim()) {
    const { data: attempt, error: attemptError } = await supabase
      .from('dialer_session_attempts')
      .select('id,lead_id')
      .eq('client_attempt_id', input.clientAttemptId.trim())
      .eq('lead_id', input.leadId)
      .maybeSingle()
    if (attemptError) throw proposalError(attemptError)
    if (!attempt?.id) return null
    attemptId = attempt.id
  }

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select(LEAD_FIELDS)
    .eq('id', input.leadId)
    .maybeSingle()
  if (leadError || !lead) throw proposalError(leadError || { message: 'ai_change_entity_not_found' })

  const current: Record<AiLeadField, string | number | null> = {
    motivation_score: typeof lead.motivation_score === 'number' ? lead.motivation_score : null,
    property_condition: typeof lead.property_condition === 'string' ? lead.property_condition : null,
    asking_price: typeof lead.asking_price === 'number' ? lead.asking_price : Number.isFinite(Number(lead.asking_price)) ? Number(lead.asking_price) : null,
    opportunity_score: typeof lead.opportunity_score === 'number' ? lead.opportunity_score : null,
    classification: typeof lead.classification === 'string' ? lead.classification : null,
  }
  const lifecycleIsDead = lead.station === 'dead' || current.classification === 'dead'
  const proposal = buildCallAnalysisLeadChanges({
    ...input.analysis,
    ...(input.analysis.classification === 'dead' || lifecycleIsDead ? { classification: undefined } : {}),
  }, current)
  if (!proposal) return null

  const summary = (input.analysis.aiSummary || input.analysis.summary || 'Review AI-extracted lead details before saving.')
    .trim()
    .slice(0, 500)
  const payloadHash = createHash('sha256').update(JSON.stringify({
    leadId: input.leadId,
    recordingSid: input.recordingSid,
    ...proposal,
  })).digest('hex')
  const insert = {
    entity_type: 'lead',
    entity_id: input.leadId,
    source_type: 'call_analysis',
    source_id: input.recordingSid,
    dialer_session_attempt_id: attemptId,
    summary,
    proposed_changes: proposal.proposedChanges,
    base_snapshot: proposal.baseSnapshot,
    payload_hash: payloadHash,
    provider: 'groq',
    model: MOJO_CALL_ANALYZER_MODEL,
    prompt_version: 'mojo-call-analyzer-v1',
    requested_by: 'system:recording_callback',
  }
  const { data, error } = await supabase
    .from('ai_change_proposals')
    .insert(insert)
    .select(PROPOSAL_SELECT)
    .maybeSingle()
  if (!error) return parseAiChangeProposal(data)
  if (!errorText(error).includes('23505') && !errorText(error).includes('duplicate')) throw proposalError(error)

  const { data: existing, error: existingError } = await supabase
    .from('ai_change_proposals')
    .select(PROPOSAL_SELECT)
    .eq('source_type', 'call_analysis')
    .eq('source_id', input.recordingSid)
    .maybeSingle()
  if (existingError) throw proposalError(existingError)
  return parseAiChangeProposal(existing)
}

export async function getAiChangeProposalsForLead(leadId: string): Promise<AiChangeProposal[]> {
  const { data, error } = await supabase
    .from('ai_change_proposals')
    .select(PROPOSAL_SELECT)
    .eq('entity_type', 'lead')
    .eq('entity_id', leadId)
    .eq('status', 'proposed')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw proposalError(error)
  return (data || []).flatMap((row) => {
    const parsed = parseAiChangeProposal(row)
    return parsed ? [parsed] : []
  })
}

export async function decideAiChangeProposalForLead(input: {
  actor: AuthenticatedActor
  leadId: string
  proposalId: string
  decision: 'approved' | 'rejected'
  decisionKey: string
  note?: string | null
}): Promise<AiChangeProposal> {
  const { data: proposal, error: proposalLookupError } = await supabase
    .from('ai_change_proposals')
    .select(PROPOSAL_SELECT)
    .eq('id', input.proposalId)
    .eq('entity_type', 'lead')
    .eq('entity_id', input.leadId)
    .maybeSingle()
  if (proposalLookupError) throw proposalError(proposalLookupError)
  const parsed = parseAiChangeProposal(proposal)
  if (!parsed) throw new DialerSessionError('ai_change_proposal_not_found', 404, 'AI change proposal not found')
  const { data, error } = await supabase.rpc('decide_ai_change_proposal_v1', {
    p_proposal_id: parsed.id,
    p_decision: input.decision,
    p_decision_key: input.decisionKey.trim(),
    p_decided_by: input.actor.email,
    p_note: input.note?.trim() || null,
  })
  if (error) throw proposalError(error)
  const decided = parseAiChangeProposal(data)
  if (!decided) throw new DialerSessionError('ai_change_proposal_unavailable', 503, 'AI change review is unavailable')
  return decided
}

export async function getAiChangeProposalForDialerAttempt(input: {
  actor: AuthenticatedActor
  sessionId: string
  clientAttemptId: string
}): Promise<AiChangeProposal | null> {
  const session = await getDialerSession(input.actor, input.sessionId)
  const { data: attempt, error } = await supabase
    .from('dialer_session_attempts')
    .select('id')
    .eq('session_id', session.id)
    .eq('client_attempt_id', input.clientAttemptId.trim())
    .maybeSingle()
  if (error) throw proposalError(error)
  if (!attempt?.id) throw new DialerSessionError('attempt_not_found', 404, 'Call attempt not found')
  return getAiChangeProposalForAttemptId(attempt.id)
}

export async function decideAiChangeProposal(input: {
  actor: AuthenticatedActor
  sessionId: string
  clientAttemptId: string
  decision: 'approved' | 'rejected'
  decisionKey: string
  note?: string | null
}): Promise<AiChangeProposal> {
  const session = await getDialerSession(input.actor, input.sessionId)
  const { data: attempt, error: attemptError } = await supabase
    .from('dialer_session_attempts')
    .select('id')
    .eq('session_id', session.id)
    .eq('client_attempt_id', input.clientAttemptId.trim())
    .maybeSingle()
  if (attemptError) throw proposalError(attemptError)
  if (!attempt?.id) throw new DialerSessionError('attempt_not_found', 404, 'Call attempt not found')

  const proposal = await getAiChangeProposalForAttemptId(attempt.id)
  if (!proposal) throw new DialerSessionError('ai_change_proposal_not_found', 404, 'AI change proposal not found')
  const { data, error } = await supabase.rpc('decide_ai_change_proposal_v1', {
    p_proposal_id: proposal.id,
    p_decision: input.decision,
    p_decision_key: input.decisionKey.trim(),
    p_decided_by: input.actor.email,
    p_note: input.note?.trim() || null,
  })
  if (error) throw proposalError(error)
  const decided = parseAiChangeProposal(data)
  if (!decided) throw new DialerSessionError('ai_change_proposal_unavailable', 503, 'AI change review is unavailable')
  return decided
}
