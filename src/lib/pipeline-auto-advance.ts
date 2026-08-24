/**
 * Advance lifecycle stages from recorded CRM events.
 *
 * Automatic changes use the same canonical lifecycle command as the human UI,
 * so ownership, department handoffs, audit history, classification, and lead
 * projection stay atomic. Manifest is historical context, not an operational
 * write target.
 */

import { queuePpcQualifiedLeadConversion } from '@/lib/ppc/qualified-lead-conversion'
import { getLeadQualificationStatus } from '@/lib/qualification-policy'
import { applyCrmLifecycleCommand, type CrmLifecycleStage } from '@/lib/server/crm-lifecycle'
import { supabaseAdmin } from '@/lib/supabase/admin'

const STAGE_ORDER = ['new', 'contacted', 'qualified', 'appointment_set', 'offer_made', 'under_contract', 'closed_won', 'closed_lost', 'dead'] as const

type AutoTrigger = 'outbound_contact' | 'appointment_set' | 'appointment_completed' | 'contract_sent' | 'contract_signed'

const AUTOMATION_ACTOR = {
  email: 'automation@savingkc.com',
  name: 'CRM Automation',
} as const

function targetStage(current: string, trigger: AutoTrigger): CrmLifecycleStage | null {
  if (trigger === 'outbound_contact' && current === 'new') return 'contacted'
  if (trigger === 'appointment_set' && ['new', 'contacted', 'qualified'].includes(current)) return 'appointment_set'
  if (trigger === 'appointment_completed' && ['new', 'contacted'].includes(current)) return 'qualified'
  if (trigger === 'contract_sent' && ['new', 'contacted', 'qualified', 'appointment_set'].includes(current)) return 'offer_made'
  if (trigger === 'contract_signed' && ['offer_made', 'appointment_set', 'qualified', 'contacted'].includes(current)) return 'under_contract'
  return null
}

export async function checkAutoAdvance(
  leadId: string,
  trigger: AutoTrigger,
): Promise<{ advanced: boolean; from?: string; to?: string }> {
  const { data: lead, error } = await supabaseAdmin()
    .from('leads')
    .select('id,station')
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw new Error(`Lifecycle record unavailable: ${error.message}`)
  if (!lead) return { advanced: false }

  const current = lead.station || 'new'
  const next = targetStage(current, trigger)
  if (!next || next === current) return { advanced: false }

  const currentIndex = STAGE_ORDER.indexOf(current as (typeof STAGE_ORDER)[number])
  const nextIndex = STAGE_ORDER.indexOf(next)
  if (currentIndex >= 0 && nextIndex >= 0 && nextIndex <= currentIndex) return { advanced: false }

  if (next === 'qualified') {
    const qualification = await getLeadQualificationStatus(leadId)
    if (!qualification.qualified) return { advanced: false }
  }

  const result = await applyCrmLifecycleCommand({
    leadId,
    commandId: crypto.randomUUID(),
    commandType: 'transition',
    stage: next,
    owner: null,
    deadReason: null,
    deadReasonNotes: null,
    reason: `Recorded CRM event: ${trigger}`,
    evidenceType: trigger === 'contract_signed' ? 'seller_contract_signed' : null,
    evidenceReference: trigger === 'contract_signed' ? `pipeline-trigger:${trigger}` : null,
    actorEmail: AUTOMATION_ACTOR.email,
    actorName: AUTOMATION_ACTOR.name,
  })

  await queuePpcQualifiedLeadConversion({
    leadId,
    fromStation: result.fromStage ?? current,
    toStation: result.stage,
    changedBy: AUTOMATION_ACTOR.name,
    reason: trigger,
  }).catch((conversionError) => console.error('[pipeline-auto-advance] PPC qualified conversion queue failed:', conversionError))

  return { advanced: true, from: result.fromStage ?? current, to: result.stage }
}
