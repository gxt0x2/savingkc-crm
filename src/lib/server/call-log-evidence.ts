import { supabase } from '@/lib/supabase-lazy'

export async function insertCallLogEvidenceOnce(input: {
  leadId: string | null
  source: 'heir_dialer' | 'telephony_bar'
  event: 'call_started' | 'call_ended'
  clientAttemptId: string | null
  payload: Record<string, unknown>
}) {
  const find = async () => {
    if (!input.clientAttemptId) return null
    let query = supabase
      .from('lead_activities')
      .select('id')
      .eq('activity_type', 'call')
    query = input.leadId ? query.eq('lead_id', input.leadId) : query.is('lead_id', null)
    const { data, error } = await query
      .contains('metadata', {
        source: input.source,
        action: input.event,
        client_attempt_id: input.clientAttemptId,
      })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error('Existing call telemetry could not be verified')
    return data as { id: string } | null
  }

  const existing = await find()
  if (existing) return { ...existing, created: false }
  const { data, error } = await supabase
    .from('lead_activities')
    .insert(input.payload)
    .select('id')
    .maybeSingle()
  if (!error && data) return { ...(data as { id: string }), created: true }
  const recovered = await find()
  if (recovered) return { ...recovered, created: false }
  throw new Error('Call telemetry could not be saved')
}
