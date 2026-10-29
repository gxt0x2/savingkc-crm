import { supabase } from '@/lib/supabase-lazy'
import {
  callerIdVerificationRetirementPatch,
  unconfirmedInboundLeadCanBeRetired,
} from '@/lib/telephony/caller-id-verification'

/**
 * Retire an unconfirmed new inbound lead created by a caller-ID verification
 * robocall. Confirmed sellers are left alone. The call activity and transcript
 * are written by the recording callback and are not deleted here.
 */
export async function retireUnconfirmedCallerIdVerificationLead(leadId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('leads')
    .select('id, classification, station, notes')
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw new Error(`caller_id_verification_lead_read_failed:${error.message}`)
  if (!data?.id || !unconfirmedInboundLeadCanBeRetired(data)) return false

  const patch = callerIdVerificationRetirementPatch(
    new Date().toISOString(),
    typeof data.notes === 'string' ? data.notes : null,
  )
  const { data: updated, error: updateError } = await supabase
    .from('leads')
    .update(patch)
    .eq('id', leadId)
    .eq('station', 'new')
    .is('classification', null)
    .select('id')
    .maybeSingle()
  if (updateError) throw new Error(`caller_id_verification_lead_update_failed:${updateError.message}`)
  if (!updated?.id) return false

  const { error: activityError } = await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'status_change',
    description: 'Marked not a lead — caller ID verification robocall',
    agent: 'System',
    metadata: {
      source: 'caller_id_verification',
      action: 'not_a_lead',
      system_call: true,
      dead_reason: patch.dead_reason,
      classification: patch.classification,
      station: patch.station,
    },
  })
  if (activityError) throw new Error(`caller_id_verification_activity_write_failed:${activityError.message}`)
  return true
}
