import { phoneLookupVariants } from '@/lib/dialer-call-policy'
import { supabase } from '@/lib/supabase-lazy'
import { inboundCallerDisplayName } from '@/lib/telephony/direct-inbound-ring'

/**
 * Best-effort CRM name for an inbound PSTN caller.
 * A lookup failure returns an empty name so the Voice client still rings.
 */
export async function lookupInboundCallerName(phone: string | null | undefined): Promise<string> {
  try {
    const variants = phoneLookupVariants(phone)
    if (variants.length === 0) return ''
    const { data, error } = await supabase
      .from('leads')
      .select('full_name')
      .in('phone', variants)
      .order('created_at', { ascending: false })
      .limit(8)
    if (error || !data) return ''
    for (const row of data) {
      const name = inboundCallerDisplayName(row.full_name)
      if (name) return name
    }
    return ''
  } catch {
    console.error('[IVR] Inbound caller name lookup failed')
    return ''
  }
}
