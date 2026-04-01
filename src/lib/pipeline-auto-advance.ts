/**
 * Auto-advance pipeline stages based on lead activity events.
 * Called from webhooks and API routes after logging activities.
 *
 * Trigger map:
 *   intake → contacted:       first outbound SMS or call to the lead
 *   contacted → qualified:    all 4 pillars captured (TIMELINE, CONDITION, MOTIVATION, PRICE)
 *   qualified → offer_made:   contract_sent activity logged
 *   offer_made → under_contract: signed contract recorded
 *   any → dead:               lead station set to 'dead'
 */

import { createClient } from '@supabase/supabase-js'

const STAGE_ORDER = ['intake', 'new', 'contacted', 'qualified', 'offer_made', 'under_contract', 'disposition', 'closed'] as const

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

  const current = lead.station || 'intake'
  let newStation: string | null = null

  switch (trigger) {
    case 'outbound_contact':
      // intake/new → contacted
      if (current === 'intake' || current === 'new') {
        newStation = 'contacted'
      }
      break

    case 'appointment_set':
      // contacted/qualified → appt_set (if using that station)
      if (['intake', 'new', 'contacted'].includes(current)) {
        newStation = 'qualified'
      }
      break

    case 'appointment_completed':
      // Move to qualifying if not already past it
      if (['intake', 'new', 'contacted', 'qualified'].includes(current)) {
        newStation = 'qualified'
      }
      break

    case 'contract_sent':
      if (['intake', 'new', 'contacted', 'qualified'].includes(current)) {
        newStation = 'offer_made'
      }
      break

    case 'contract_signed':
      if (['offer_made', 'qualified', 'contacted'].includes(current)) {
        newStation = 'under_contract'
      }
      break
  }

  if (!newStation || newStation === current) return { advanced: false }

  // Don't go backwards
  const currentIdx = STAGE_ORDER.indexOf(current as any)
  const newIdx = STAGE_ORDER.indexOf(newStation as any)
  if (currentIdx >= 0 && newIdx >= 0 && newIdx <= currentIdx) {
    return { advanced: false }
  }

  // Advance
  await supabase
    .from('leads')
    .update({ station: newStation })
    .eq('id', leadId)

  // Log the transition
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

  // Also update manifest pipeline if one exists
  try {
    const { data: manifestRow } = await supabase
      .from('manifests')
      .select('id, manifest')
      .eq('lead_id', leadId)
      .limit(1)
      .single()

    if (manifestRow?.manifest) {
      const manifest = manifestRow.manifest as any
      manifest.currentStation = newStation
      manifest.lastUpdated = new Date().toISOString()
      manifest.lastUpdatedBy = 'system:pipeline'

      // Mark the manifest pipeline stage as completed
      const stageMap: Record<string, string> = {
        contacted: 'qualifying',
        qualified: 'discovery',
        offer_made: 'offer',
        under_contract: 'contract',
        closed: 'closed',
      }
      const manifestStage = stageMap[newStation]
      if (manifestStage && manifest.pipeline?.[manifestStage]) {
        manifest.pipeline[manifestStage].status = 'completed'
        manifest.pipeline[manifestStage].completedAt = new Date().toISOString()
      }

      // Mark briefing as stale so Ari regenerates
      if (manifest.ariIntelligence) {
        manifest.ariIntelligence.briefingStale = true
      }

      await supabase
        .from('manifests')
        .update({ manifest, updated_at: new Date().toISOString() })
        .eq('id', manifestRow.id)
    }
  } catch {} // Non-critical — manifest sync is best-effort

  return { advanced: true, from: current, to: newStation }
}
