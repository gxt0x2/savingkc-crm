import { supabase } from '@/lib/supabase-lazy'

const PARENT_CALL_SID = /^CA[0-9a-f]{32}$/i

/**
 * Store the browser-leg Call SID without touching provider_child_call_sid.
 * The child `<Number>` status callback is the only writer of that metadata.
 * coalesce on the child callback keeps a parent SID that arrived first.
 */
export async function rememberOutboundParentCallSid(input: {
  clientAttemptId: string | null | undefined
  callSid: string | null | undefined
  sessionId?: string | null
}): Promise<boolean> {
  const clientAttemptId = input.clientAttemptId?.trim() || ''
  const callSid = input.callSid?.trim() || ''
  if (!clientAttemptId || !PARENT_CALL_SID.test(callSid)) return false
  let query = supabase
    .from('dialer_session_attempts')
    .update({ provider_call_sid: callSid })
    .eq('client_attempt_id', clientAttemptId)
    .is('provider_call_sid', null)
  if (input.sessionId) query = query.eq('session_id', input.sessionId)
  const { data, error } = await query.select('id').maybeSingle()
  if (error) throw error
  return Boolean(data?.id)
}
