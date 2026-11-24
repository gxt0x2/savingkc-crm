import { supabase } from '@/lib/supabase-lazy'

/** Latest outbound SMS body on this contact or, before a contact exists, to this phone. */
export async function loadLatestOutboundSmsBody(input: {
  phone: string
  leadId?: string | null
}): Promise<string | null> {
  const filtered = supabase
    .from('lead_activities')
    .select('description')
    .eq('activity_type', 'sms')
    .eq('metadata->>direction', 'outbound')
  const scoped = input.leadId
    ? filtered.eq('lead_id', input.leadId)
    : filtered.eq('metadata->>to', input.phone)
  const { data, error } = await scoped.order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`Outbound SMS lookup failed: ${error.message}`)
  return typeof data?.description === 'string' ? data.description : null
}
