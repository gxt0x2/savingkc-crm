import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { supabase } from '@/lib/supabase-lazy'

export class CallLogContextError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message)
    this.name = 'CallLogContextError'
  }
}

export interface CallLogContext {
  leadId: string | null
  leadName: string
  heir: {
    name: string | null
    relationship: string | null
    prospectPhoneId: string
    ownerName: string | null
  } | null
}

export async function resolveCallLogContext(input: {
  phone: string
  leadId: string | null
  prospectPhoneId: string | null
}): Promise<CallLogContext> {
  if (input.prospectPhoneId) {
    const { data, error } = await supabase
      .from('prospect_phones')
      .select('id,phone,contact_name,relationship,prospects(lead_id,owner_1)')
      .eq('id', input.prospectPhoneId)
      .maybeSingle()
    const prospect = data as {
      id: string
      phone: string
      contact_name: string | null
      relationship: string | null
      prospects: { lead_id: string | null; owner_1: string | null } | null
    } | null
    if (error || !prospect) throw new CallLogContextError('Heir phone context is unavailable')
    const resolvedLeadId = prospect.prospects?.lead_id ?? null
    if (
      !resolvedLeadId
      || (input.leadId && input.leadId !== resolvedLeadId)
      || normalizePhoneToE164(prospect.phone) !== input.phone
    ) {
      throw new CallLogContextError('Call context does not match the selected heir')
    }
    return {
      leadId: resolvedLeadId,
      leadName: prospect.prospects?.owner_1 || input.phone,
      heir: {
        name: prospect.contact_name,
        relationship: prospect.relationship,
        prospectPhoneId: prospect.id,
        ownerName: prospect.prospects?.owner_1 ?? null,
      },
    }
  }

  if (input.leadId) {
    const { data, error } = await supabase
      .from('leads')
      .select('id,full_name,phone')
      .eq('id', input.leadId)
      .maybeSingle()
    if (error || !data) throw new CallLogContextError('Selected contact is unavailable')
    if (normalizePhoneToE164(data.phone || '') !== input.phone) {
      throw new CallLogContextError('Call phone does not match the selected contact')
    }
    return { leadId: data.id, leadName: data.full_name || input.phone, heir: null }
  }

  return { leadId: null, leadName: input.phone, heir: null }
}
