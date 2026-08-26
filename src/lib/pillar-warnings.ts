/**
 * ARI CRM - Pillar Warnings for Ari Briefing
 * Night 3: CIM-02
 *
 * Connect missing pillar data to Ari briefing for callbacks
 */

import { createClient } from '@supabase/supabase-js'
import { getLeadQualificationStatus } from '@/lib/qualification-policy'

export const PILLARS = ['TIMELINE', 'CONDITION', 'MOTIVATION', 'PRICE'] as const
export type PillarType = (typeof PILLARS)[number]

export interface PillarStatus {
  TIMELINE: boolean
  CONDITION: boolean
  MOTIVATION: boolean
  PRICE: boolean
}

export interface MissingPillarWarning {
  lead_id: string
  lead_name: string | null
  missing_pillars: PillarType[]
  callback_time?: string
}

type CallbackWithLead = {
  lead_id: string | null
  metadata: { due_date?: string } | null
  leads: { full_name: string | null } | { full_name: string | null }[] | null
}

/**
 * Get pillar status for a lead
 */
export async function getLeadPillarStatus(
  leadId: string
): Promise<PillarStatus> {
  const status = await getLeadQualificationStatus(leadId)
  return status.pillars
}

/**
 * Get missing pillars for a lead
 */
export async function getMissingPillars(
  leadId: string
): Promise<PillarType[]> {
  const status = await getLeadPillarStatus(leadId)

  return PILLARS.filter((pillar) => !status[pillar])
}

/**
 * Generate Ari briefing description for callback with missing pillars
 */
export function generateCallbackDescription(
  leadName: string | null,
  callbackTime: string,
  missingPillars: PillarType[]
): string {
  const name = leadName || 'Lead'
  const time = new Date(callbackTime).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })

  if (missingPillars.length === 0) {
    return `Callback with ${name} at ${time}. All pillars captured`
  }

  const pillarList = missingPillars.join(', ')
  const count = missingPillars.length

  return `Callback with ${name} at ${time}. Still need ${count} ${count === 1 ? 'pillar' : 'pillars'}: ${pillarList}`
}

/**
 * Create Ari briefing event for callback with pillar status
 */
export async function createCallbackBriefingWithPillars(
  leadId: string,
  leadName: string | null,
  callbackTime: string
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const missingPillars = await getMissingPillars(leadId)
  const description = generateCallbackDescription(
    leadName,
    callbackTime,
    missingPillars
  )

  // Determine priority based on missing pillars
  const priority =
    missingPillars.length === 0
      ? 'medium'
      : missingPillars.length >= 3
      ? 'high'
      : 'medium'

  await supabase.from('ari_briefing_events').insert({
    event_type: 'follow_up_overdue',
    priority,
    title: `Callback: ${leadName || 'Unknown'}`,
    description,
    lead_id: leadId,
    action_url: `/leads/${leadId}`,
    metadata: { missing_pillars: missingPillars },
    read: false,
    dismissed: false,
    created_at: new Date().toISOString(),
  })
}

/**
 * Scan all scheduled callbacks and create briefing events with pillar warnings
 * This should be called in the morning briefing generation
 */
export async function generateCallbackPillarWarnings(): Promise<number> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const today = new Date().toISOString().split('T')[0]

  // Get today's callbacks
  const { data: callbacks } = await supabase
    .from('lead_activities')
    .select('lead_id, metadata, leads(full_name)')
    .eq('type', 'callback')
    .eq('metadata->status', 'pending')
    .gte('metadata->due_date', today)
    .lt('metadata->due_date', `${today}T23:59:59`)

  if (!callbacks || callbacks.length === 0) return 0

  let created = 0

  for (const rawCallback of callbacks) {
    const callback = rawCallback as unknown as CallbackWithLead
    const relatedLead = Array.isArray(callback.leads) ? callback.leads[0] : callback.leads
    const leadName = relatedLead?.full_name ?? null
    const callbackTime = callback.metadata?.due_date

    if (callback.lead_id && callbackTime) {
      await createCallbackBriefingWithPillars(
        callback.lead_id,
        leadName,
        callbackTime
      )
      created++
    }
  }

  return created
}
