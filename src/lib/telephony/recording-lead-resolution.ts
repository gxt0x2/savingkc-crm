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

/** A recording callback often has neither From nor To. Its durable call rows
 * establish direction; previous recording callbacks are not call evidence.
 */
export function recordingDirectionFromActivities(rows: Array<{ metadata?: unknown }>): 'inbound' | 'outbound' | undefined {
  const directions = new Set<'inbound' | 'outbound'>()
  for (const row of rows) {
    const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {}
    if (metadata.source === 'twilio_recording_callback') continue
    const value = typeof metadata.direction === 'string' ? metadata.direction.trim().toLowerCase() : ''
    if (['inbound', 'incoming', 'in', 'received', 'inbound-api'].includes(value)) directions.add('inbound')
    if (['outbound', 'outgoing', 'out', 'sent', 'outbound-api'].includes(value)) directions.add('outbound')
  }
  return directions.size === 1 ? [...directions][0] : undefined
}

export async function resolveRecordingCallDirection(callSid: string, leadId: string): Promise<'inbound' | 'outbound' | undefined> {
  const filter = callSidActivityOrFilter(callSid)
  if (!filter || !leadId) return undefined
  const { data, error } = await supabase.from('lead_activities').select('metadata')
    .eq('lead_id', leadId).in('activity_type', ['call', 'missed_call'])
    .or(filter).order('created_at', { ascending: false }).limit(25)
  if (error) throw new Error('Recorded call direction could not be loaded.')
  return recordingDirectionFromActivities(data ?? [])
}
