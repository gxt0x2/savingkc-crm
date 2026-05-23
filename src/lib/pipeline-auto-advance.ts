/**
 * Auto-advance pipeline stages based on lead activity events.
 * Called from webhooks and API routes after logging activities.
 *
 * Trigger map:
 *   new → contacted:          first outbound SMS or call to the lead
 *   contacted → qualified:    all 4 pillars captured (TIMELINE, CONDITION, MOTIVATION, PRICE)
 *   qualified → offer_made:   contract_sent activity logged
 *   offer_made → under_contract: signed contract recorded
 *   any → dead:               lead station set to 'dead'
 */

import { createClient } from '@supabase/supabase-js'
import { queuePpcQualifiedLeadConversion } from '@/lib/ppc/qualified-lead-conversion'
import type { ManifestV2 } from '@/lib/manifest-builder'

const STAGE_ORDER = ['new', 'contacted', 'qualified', 'appointment_set', 'offer_made', 'under_contract', 'closed_won', 'closed_lost', 'dead'] as const
type ManifestPipelineStageKey = Exclude<Extract<keyof ManifestV2['pipeline'], string>, 'appointment'>

type AutoTrigger = 'outbound_contact' | 'appointment_set' | 'appointment_completed' | 'contract_sent' | 'contract_signed'

export async function checkAutoAdvance(
  leadId: string,
  trigger: AutoTrigger,
): Promise<{ advanced: boolean; from?: string; to?: string }> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: lead } = await supabase
    .from('leads')
    .select('id, station, priority')
    .eq('id', leadId)
    .single()

  if (!lead) return { advanced: false }

  const current = lead.station || 'new'
  let newStation: string | null = null

  switch (trigger) {
    case 'outbound_contact':
      // new → contacted
      if (current === 'new') {
        newStation = 'contacted'
      }
      break

    case 'appointment_set':
      if (['new', 'contacted', 'qualified'].includes(current)) {
        newStation = 'appointment_set'
      }
      break

    case 'appointment_completed':
      if (['new', 'contacted'].includes(current)) {
        newStation = 'qualified'
      }
      break

    case 'contract_sent':
      if (['new', 'contacted', 'qualified', 'appointment_set'].includes(current)) {
        newStation = 'offer_made'
      }
      break

    case 'contract_signed':
      if (['offer_made', 'appointment_set', 'qualified', 'contacted'].includes(current)) {
        newStation = 'under_contract'
      }
      break
  }

  if (!newStation || newStation === current) return { advanced: false }

  // Don't go backwards
  const currentIdx = STAGE_ORDER.indexOf(current as typeof STAGE_ORDER[number])
  const newIdx = STAGE_ORDER.indexOf(newStation as typeof STAGE_ORDER[number])
  if (currentIdx >= 0 && newIdx >= 0 && newIdx <= currentIdx) {
    return { advanced: false }
  }

  // Use updateManifestAndCascade for proper Hot Engine sync
  const { updateManifestAndCascade } = await import('./manifest-sync')

  const cascaded = await updateManifestAndCascade(leadId, (manifest: ManifestV2) => {
    manifest.currentStation = newStation

    const stageMap: Partial<Record<string, ManifestPipelineStageKey>> = {
      contacted: 'qualifying', qualified: 'discovery',
      appointment_set: 'discovery', offer_made: 'offer', under_contract: 'contract', closed_won: 'closed',
    }
    const manifestStage = stageMap[newStation]
    if (manifestStage && manifest.pipeline?.[manifestStage]) {
      manifest.pipeline[manifestStage].status = 'completed'
      manifest.pipeline[manifestStage].completedAt = new Date().toISOString()
      manifest.pipeline[manifestStage].enteredAt =
        manifest.pipeline[manifestStage].enteredAt || new Date().toISOString()
    }

    if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
    manifest.ariIntelligence.briefingStale = true

    if (!manifest.auditTrail) manifest.auditTrail = []
    manifest.auditTrail.push({
      timestamp: new Date().toISOString(),
      agent: 'system:pipeline',
      action: 'station_advanced',
      details: { from: current, to: newStation, trigger },
    })
  }, 'system:pipeline')

  if (!cascaded) {
    // No manifest exists — fallback to direct leads update
    await supabase.from('leads').update({ station: newStation }).eq('id', leadId)
  }

  // Log the transition as activity
  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'status_change',
    description: `Pipeline auto-advanced: ${current} → ${newStation}`,
    agent: 'System',
    metadata: {
      from_stage: current,
      to_stage: newStation,
      trigger,
      method: 'auto_trigger',
      new_station: newStation,
    },
  })

  await queuePpcQualifiedLeadConversion({
    leadId,
    fromStation: current,
    toStation: newStation,
    changedBy: 'system:pipeline',
    reason: trigger,
  }).catch((error) => console.error('[pipeline-auto-advance] PPC qualified conversion queue failed:', error))

  return { advanced: true, from: current, to: newStation }
}
