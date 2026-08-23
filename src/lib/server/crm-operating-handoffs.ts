import { supabaseAdmin } from '@/lib/supabase/admin'

export class CrmOperatingHandoffError extends Error {}

export async function recordAssignmentToTcHandoff(input: {
  commandId: string
  leadId: string
  buyerOfferId: string
  tcFileId: string
  evidenceReference: string | null
  actorEmail: string
  actorName: string
}) {
  const { data, error } = await supabaseAdmin().rpc('crm_record_department_handoff_v1', {
    target_command_id: input.commandId,
    target_lead_id: input.leadId,
    target_from_department: 'dispositions',
    target_to_department: 'transaction_coordination',
    target_source_record_type: 'buyer_offer',
    target_source_record_id: input.buyerOfferId,
    target_record_type: 'tc_file',
    target_record_id: input.tcFileId,
    target_evidence_type: 'assignment_signed',
    target_evidence_reference: input.evidenceReference,
    target_actor_email: input.actorEmail,
    target_actor_name: input.actorName,
    target_reason: 'Fully executed buyer assignment received by Transaction Coordination',
  })
  if (error) throw new CrmOperatingHandoffError(error.message || 'TC handoff could not be recorded')
  return data as { handoffId: string; status: 'accepted'; replayed: boolean }
}

export async function recordVerifiedMarketingOutcome(input: {
  outcomeKey: string
  leadId: string
  outcome: 'closed_won' | 'fell_through'
  revenue: number
  occurredAt: string
  evidenceType: 'funded_closeout' | 'verified_fallout'
  evidenceId: string
  actorName: string
}) {
  const { data, error } = await supabaseAdmin().rpc('crm_record_marketing_outcome_v1', {
    target_outcome_key: input.outcomeKey,
    target_lead_id: input.leadId,
    target_outcome: input.outcome,
    target_revenue: input.revenue,
    target_occurred_at: input.occurredAt,
    target_evidence_type: input.evidenceType,
    target_evidence_id: input.evidenceId,
    target_actor_name: input.actorName,
  })
  if (error) throw new CrmOperatingHandoffError(error.message || 'Marketing outcome could not be recorded')
  return data as { outcomeId: string; outcome: string; revenue: number }
}

export async function finalizeFundedClose(input: {
  dealId: string
  closeout: Record<string, unknown>
  fundedAt: string
  assignmentFee: number
  closeDate: string
  debriefDueAt: string
  actorEmail: string
  actorName: string
  netRevenue: number
}) {
  const { data, error } = await supabaseAdmin().rpc('crm_finalize_funded_close_v1', {
    target_deal_id: input.dealId,
    target_closeout: input.closeout,
    target_funded_at: input.fundedAt,
    target_assignment_fee: input.assignmentFee,
    target_close_date: input.closeDate,
    target_debrief_due_at: input.debriefDueAt,
    target_actor_email: input.actorEmail,
    target_actor_name: input.actorName,
    target_net_revenue: input.netRevenue,
  })
  if (error) throw new CrmOperatingHandoffError(error.message || 'Funded closeout could not be finalized')
  return data as {
    deal: Record<string, unknown>
    lifecycle: Record<string, unknown>
    marketingOutcome: Record<string, unknown>
  }
}
