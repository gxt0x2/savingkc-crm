import { supabase } from '@/lib/supabase-lazy'
import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import type { CallAnalysisResult } from '@/lib/mojo-call-analyzer'
import { DialerSessionError, getDialerSession } from '@/lib/server/dialer-session-engine'
import {
  parseDialerPostCallReview,
  postCallSnapshot,
  type DialerPostCallReview,
} from '@/lib/dialer-post-call-review'

export { parseDialerPostCallReview, postCallSnapshot }
export type { DialerPostCallReview }

async function updateAttempt(
  clientAttemptId: string | null,
  updates: Record<string, unknown>,
  leadId?: string | null,
): Promise<boolean> {
  if (!clientAttemptId?.trim()) return false
  let query = supabase
    .from('dialer_session_attempts')
    .update(updates)
    .eq('client_attempt_id', clientAttemptId.trim())
  if (leadId) query = query.eq('lead_id', leadId)
  const { data, error } = await query.select('id').maybeSingle()
  if (error) throw error
  return Boolean(data?.id)
}

export async function markDialerPostCallProcessing(input: {
  clientAttemptId: string | null
  leadId: string
  providerCallSid: string | null
  recordingSid: string
}): Promise<boolean> {
  return updateAttempt(input.clientAttemptId, {
    provider_call_sid: input.providerCallSid || null,
    recording_sid: input.recordingSid,
    post_call_status: 'processing',
    post_call_summary: null,
    post_call_snapshot: {},
    post_call_completed_at: null,
    post_call_updated_at: new Date().toISOString(),
  }, input.leadId)
}

export async function completeDialerPostCallReview(input: {
  clientAttemptId: string | null
  leadId: string
  providerCallSid: string | null
  recordingSid: string
  analysis: CallAnalysisResult
}): Promise<boolean> {
  const summary = typeof input.analysis.aiSummary === 'string' && input.analysis.aiSummary.trim()
    ? input.analysis.aiSummary.trim()
    : typeof input.analysis.summary === 'string' && input.analysis.summary.trim()
      ? input.analysis.summary.trim()
      : null
  return updateAttempt(input.clientAttemptId, {
    provider_call_sid: input.providerCallSid || null,
    recording_sid: input.recordingSid,
    post_call_status: summary ? 'ready' : 'unavailable',
    post_call_summary: summary,
    post_call_snapshot: summary ? postCallSnapshot(input.analysis) : { failureCode: 'analysis_empty' },
    post_call_completed_at: new Date().toISOString(),
    post_call_updated_at: new Date().toISOString(),
  }, input.leadId)
}

export async function markDialerPostCallUnavailable(input: {
  clientAttemptId: string | null
  leadId?: string | null
  providerCallSid?: string | null
  recordingSid?: string | null
  status?: 'unavailable' | 'skipped'
  failureCode: string
}): Promise<boolean> {
  return updateAttempt(input.clientAttemptId, {
    ...(input.providerCallSid ? { provider_call_sid: input.providerCallSid } : {}),
    ...(input.recordingSid ? { recording_sid: input.recordingSid } : {}),
    post_call_status: input.status || 'unavailable',
    post_call_summary: null,
    post_call_snapshot: { failureCode: input.failureCode },
    post_call_completed_at: new Date().toISOString(),
    post_call_updated_at: new Date().toISOString(),
  }, input.leadId)
}

export async function getDialerPostCallReview(
  actor: AuthenticatedActor,
  sessionId: string,
  clientAttemptId: string,
): Promise<DialerPostCallReview> {
  const session = await getDialerSession(actor, sessionId)
  const { data, error } = await supabase
    .from('dialer_session_attempts')
    .select('post_call_status,post_call_summary,post_call_snapshot,post_call_completed_at,post_call_updated_at,recording_sid,provider_call_sid')
    .eq('session_id', session.id)
    .eq('client_attempt_id', clientAttemptId.trim())
    .maybeSingle()
  if (error) throw error
  if (!data) throw new DialerSessionError('attempt_not_found', 404, 'Call attempt not found')
  return parseDialerPostCallReview(data)
}
