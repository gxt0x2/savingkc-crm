import { supabase } from '@/lib/supabase-lazy'

export interface HeirAttemptEvidenceRow {
  id: string
  metadata: Record<string, unknown> | null
}

interface EvidenceInput {
  leadId: string | null
  prospectId?: string | null
  activityType: 'appointment' | 'call' | 'status_change'
  clientAttemptId: string | null
  action?: 'appointment_set' | 'mark_dead' | 'mark_as_lead'
  payload: Record<string, unknown>
}

export async function findHeirAttemptEvidence(
  input: Omit<EvidenceInput, 'payload'>,
): Promise<HeirAttemptEvidenceRow | null> {
  if (!input.clientAttemptId) return null
  const metadata: Record<string, unknown> = {
    source: 'heir_dialer',
    client_attempt_id: input.clientAttemptId,
  }
  if (input.action) metadata.action = input.action
  if (input.prospectId) metadata.prospect_id = input.prospectId

  let query = supabase
    .from('lead_activities')
    .select('id,metadata')
    .eq('activity_type', input.activityType)
    .contains('metadata', metadata)
    .order('created_at', { ascending: false })
    .limit(1)
  query = input.leadId
    ? query.eq('lead_id', input.leadId)
    : query.is('lead_id', null)
  const { data, error } = await query
    .maybeSingle()
  if (error) throw new Error('Existing heir call outcome could not be verified')
  return (data as HeirAttemptEvidenceRow | null) ?? null
}

export async function insertHeirAttemptEvidenceOnce(input: EvidenceInput): Promise<HeirAttemptEvidenceRow> {
  const existing = await findHeirAttemptEvidence(input)
  if (existing) return existing

  const { data, error } = await supabase
    .from('lead_activities')
    .insert(input.payload)
    .select('id,metadata')
    .maybeSingle()
  if (!error && data) return data as HeirAttemptEvidenceRow

  const recovered = await findHeirAttemptEvidence(input)
  if (recovered) return recovered
  throw new Error('Heir call evidence could not be saved')
}
