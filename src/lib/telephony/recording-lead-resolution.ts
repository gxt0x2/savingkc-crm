import { supabase } from '@/lib/supabase-lazy'

const CALL_SID_METADATA_FIELDS = ['callSid', 'CallSid', 'call_sid', 'parentCallSid', 'parent_call_sid'] as const

export function callSidActivityOrFilter(callSid: string): string | null {
  const normalized = callSid.trim()
  // Twilio SIDs are alphanumeric. Reject PostgREST control characters rather
  // than interpolating untrusted callback input into an `.or()` expression.
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(normalized)) return null
  return CALL_SID_METADATA_FIELDS
    .map((field) => `metadata->>${field}.eq.${normalized}`)
    .join(',')
}

export async function resolveLeadIdFromCallActivity(callSid: string): Promise<string | null> {
  const filter = callSidActivityOrFilter(callSid)
  if (!filter) return null

  const { data, error } = await supabase
    .from('lead_activities')
    .select('lead_id')
    .or(filter)
    .not('lead_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[recording-callback] call activity lookup failed', error.message)
    return null
  }

  return typeof data?.lead_id === 'string' ? data.lead_id : null
}
