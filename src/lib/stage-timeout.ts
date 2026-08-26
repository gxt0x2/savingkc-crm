/**
 * ARI CRM - Stage Timeout Alerts
 * Night 3: Pipeline Brain - WRK-11
 *
 * Detects leads sitting too long in a stage and generates alerts
 */

import { createClient } from '@supabase/supabase-js'
import { STAGE_DEFINITIONS, type StageId } from './stage-logic'

export interface StageTimeoutAlert {
  lead_id: string
  lead_name: string | null
  property_address: string | null
  stage: StageId
  stage_name: string
  hours_in_stage: number
  timeout_hours: number
  priority: 'critical' | 'high' | 'medium'
  action_required: string
}

/**
 * Check for leads that have exceeded their stage timeout thresholds
 * This function is cron-ready and can be called on a schedule
 */
export async function checkStageTimeouts(): Promise<StageTimeoutAlert[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const alerts: StageTimeoutAlert[] = []

  // Get all leads (exclude dead)
  const { data: leads } = await supabase
    .from('leads')
    .select('id, full_name, property_address, station, created_at')
    .not('station', 'eq', 'dead')

  if (!leads) return alerts

  for (const lead of leads) {
    const station = lead.station as StageId
    if (!station) continue

    const stageDef = STAGE_DEFINITIONS[station]
    if (!stageDef || !stageDef.timeoutHours) continue

    // Get the most recent stage transition for this lead
    const { data: lastTransition } = await supabase
      .from('stage_transitions')
      .select('created_at')
      .eq('lead_id', lead.id)
      .eq('to_stage', station)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // If no transition found, use lead creation date
    const stageEntryTime = lastTransition
      ? new Date(lastTransition.created_at)
      : new Date(lead.created_at)

    const now = new Date()
    const hoursInStage =
      (now.getTime() - stageEntryTime.getTime()) / (1000 * 60 * 60)

    if (hoursInStage > stageDef.timeoutHours) {
      alerts.push({
        lead_id: lead.id,
        lead_name: lead.full_name,
        property_address: lead.property_address,
        stage: station,
        stage_name: stageDef.name,
        hours_in_stage: Math.round(hoursInStage),
        timeout_hours: stageDef.timeoutHours,
        priority: getPriorityForStageTimeout(station, hoursInStage),
        action_required: getActionForStageTimeout(station),
      })
    }
  }

  return alerts
}

/**
 * Determine alert priority based on stage and how long overdue
 */
function getPriorityForStageTimeout(
  stage: StageId,
  hoursInStage: number
): 'critical' | 'high' | 'medium' {
  // Critical stages: offer_made, qualified
  if (stage === 'offer_made' && hoursInStage > 72) return 'critical'
  if (stage === 'qualified' && hoursInStage > 120) return 'critical'

  // High priority stages: new, contacted
  if (stage === 'new' && hoursInStage > 48) return 'high'
  if (stage === 'contacted' && hoursInStage > 168) return 'high'

  return 'medium'
}

/**
 * Get recommended action for timed-out stage
 */
function getActionForStageTimeout(stage: StageId): string {
  switch (stage) {
    case 'new':
      return 'First contact attempt required - call immediately'
    case 'contacted':
      return 'Follow-up overdue - schedule callback or next touch'
    case 'qualified':
      return 'Offer pending - run deal math and prepare offer'
    case 'offer_made':
      return 'No response to offer - follow up immediately or adjust offer'
    default:
      return 'Advancement or action required'
  }
}

/**
 * Generate Ari briefing events for stage timeouts
 * Inserts into ari_briefing_events table (to be created in ARI-01)
 */
export async function generateTimeoutBriefingEvents(): Promise<number> {
  const alerts = await checkStageTimeouts()

  if (alerts.length === 0) return 0

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const events = alerts.map((alert) => ({
    event_type: 'stage_timeout',
    priority: alert.priority,
    title: `${alert.stage_name} timeout: ${alert.lead_name || alert.property_address || 'Unknown lead'}`,
    description: `Lead has been in ${alert.stage_name} for ${alert.hours_in_stage} hours (threshold: ${alert.timeout_hours}h). ${alert.action_required}`,
    lead_id: alert.lead_id,
    action_url: `/leads/${alert.lead_id}`,
    read: false,
    dismissed: false,
    created_at: new Date().toISOString(),
  }))

  const { error } = await supabase.from('ari_briefing_events').insert(events)

  if (error) {
    console.error('Failed to create timeout briefing events:', error)
    return 0
  }

  return events.length
}

/**
 * Check for contract deadlines (inspection, closing) for under_contract leads
 */
export async function checkContractDeadlines(): Promise<StageTimeoutAlert[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const alerts: StageTimeoutAlert[] = []

  // Get all under_contract leads
  const { data: leads } = await supabase
    .from('leads')
    .select('id, full_name, property_address, metadata')
    .eq('station', 'under_contract')

  if (!leads) return alerts

  const now = new Date()

  for (const lead of leads) {
    const metadata = lead.metadata as {
      inspection_end_date?: string
      closing_date?: string
    } | null

    // Check inspection deadline (flag if <48hrs)
    if (metadata?.inspection_end_date) {
      const inspectionDate = new Date(metadata.inspection_end_date)
      const hoursUntilInspection =
        (inspectionDate.getTime() - now.getTime()) / (1000 * 60 * 60)

      if (hoursUntilInspection < 48 && hoursUntilInspection > 0) {
        alerts.push({
          lead_id: lead.id,
          lead_name: lead.full_name,
          property_address: lead.property_address,
          stage: 'under_contract',
          stage_name: 'Under Contract',
          hours_in_stage: Math.round(48 - hoursUntilInspection),
          timeout_hours: 48,
          priority: 'critical',
          action_required: `Inspection deadline in ${Math.round(hoursUntilInspection)} hours - ensure inspection is scheduled`,
        })
      }
    }

    // Check closing deadline (flag if <7 days)
    if (metadata?.closing_date) {
      const closingDate = new Date(metadata.closing_date)
      const hoursUntilClosing =
        (closingDate.getTime() - now.getTime()) / (1000 * 60 * 60)

      if (hoursUntilClosing < 168 && hoursUntilClosing > 0) {
        alerts.push({
          lead_id: lead.id,
          lead_name: lead.full_name,
          property_address: lead.property_address,
          stage: 'under_contract',
          stage_name: 'Under Contract',
          hours_in_stage: Math.round(168 - hoursUntilClosing),
          timeout_hours: 168,
          priority: 'high',
          action_required: `Closing in ${Math.round(hoursUntilClosing / 24)} days - ensure all docs ready`,
        })
      }
    }
  }

  return alerts
}
