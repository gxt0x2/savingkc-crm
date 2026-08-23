/**
 * ARI CRM - Stage Logic & Requirements Engine
 * 8-Stage Pipeline with Gates and Auto-Triggers
 * Night 3: Pipeline Brain
 */

import { createClient } from '@supabase/supabase-js'
import type { ManifestV2 } from '@/lib/manifest-builder'
import { getLeadQualificationStatus } from '@/lib/qualification-policy'

// ============================================================================
// TYPES
// ============================================================================

export type StageId =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'offer_made'
  | 'under_contract'
  | 'disposition'
  | 'closed'
  | 'dead'

export interface StageRequirement {
  field: string
  label: string
  check: (lead: StageLeadData) => boolean
  critical: boolean // If true, blocks advancement
}

type StageLeadData = {
  full_name?: string | null
  property_address?: string | null
  phone?: string | null
  source?: string | null
  metadata?: Record<string, unknown> | null
}

export interface StageDefinition {
  id: StageId
  number: number
  name: string
  description: string
  requirements: StageRequirement[]
  autoTriggers: string[]
  autoActions: string[]
  timeoutHours: number | null
}

export interface StageValidationResult {
  valid: boolean
  missing: string[]
  warnings: string[]
}

// ============================================================================
// STAGE DEFINITIONS
// ============================================================================

export const STAGE_DEFINITIONS: Record<StageId, StageDefinition> = {
  // STAGE 1: NEW
  new: {
    id: 'new',
    number: 1,
    name: 'New',
    description: 'Fresh lead, not yet contacted',
    requirements: [
      {
        field: 'name_or_address',
        label: 'Name OR Property Address',
        check: (lead) => !!(lead.full_name || lead.property_address),
        critical: true,
      },
      {
        field: 'contact_method',
        label: 'Phone Number OR Property Address',
        check: (lead) => !!(lead.phone || lead.property_address),
        critical: true,
      },
      {
        field: 'source',
        label: 'Lead Source',
        check: (lead) => !!lead.source,
        critical: true,
      },
    ],
    autoTriggers: [
      'Lead created from any source',
      'Missed call auto-create (MCF-03)',
      'Website form submission',
    ],
    autoActions: [
      'If phone missing: flag for skip trace',
      'Create initial follow-up task',
      'Queue for first contact attempt',
    ],
    timeoutHours: 48, // Alert if no contact attempt within 48 hours
  },

  // STAGE 2: CONTACTED
  contacted: {
    id: 'contacted',
    number: 2,
    name: 'Contacted',
    description: 'Made contact with lead',
    requirements: [
      {
        field: 'ownership_confirmed',
        label: 'Confirmed Ownership',
        check: (lead) => {
          // Check for ownership confirmation in metadata or pillar data
          return lead.metadata?.ownership_confirmed === true
        },
        critical: true,
      },
      {
        field: 'property_address',
        label: 'Confirmed Property Address',
        check: (lead) => !!lead.property_address,
        critical: true,
      },
      {
        field: 'initial_motivation',
        label: 'Initial Motivation Captured',
        check: (lead) => {
          // Check if motivation pillar exists
          return lead.metadata?.motivation !== undefined
        },
        critical: false,
      },
    ],
    autoTriggers: [
      'Agent logs disposition: "spoke_with_owner"',
      'Lead responds to SMS/email',
    ],
    autoActions: [],
    timeoutHours: 168, // 7 days - alert if no follow-up
  },

  // STAGE 3: OPPORTUNITY (stored as `qualified` for data compatibility)
  qualified: {
    id: 'qualified',
    number: 3,
    name: 'Opportunity',
    description: 'All 4 qualification pillars captured',
    requirements: [
      {
        field: 'pillar_timeline',
        label: 'TIMELINE - When do they need to sell?',
        check: (lead) => !!lead.metadata?.TIMELINE,
        critical: true, // HARD GATE
      },
      {
        field: 'pillar_condition',
        label: 'CONDITION - Property physical condition',
        check: (lead) => !!lead.metadata?.CONDITION,
        critical: true, // HARD GATE
      },
      {
        field: 'pillar_motivation',
        label: 'MOTIVATION - Why selling and urgency',
        check: (lead) => !!lead.metadata?.MOTIVATION,
        critical: true, // HARD GATE
      },
      {
        field: 'pillar_price',
        label: 'PRICE - Asking price or flexibility',
        check: (lead) => !!lead.metadata?.PRICE,
        critical: true, // HARD GATE
      },
    ],
    autoTriggers: ['All 4 pillars captured in system'],
    autoActions: [],
    timeoutHours: 120, // 5 days - alert if no offer action
  },

  // STAGE 4: OFFER MADE
  offer_made: {
    id: 'offer_made',
    number: 4,
    name: 'Offer Made',
    description: 'Contract/offer sent to seller',
    requirements: [
      {
        field: 'mao_calculated',
        label: 'MAO Calculated (Deal Math)',
        check: (lead) => lead.metadata?.mao !== undefined,
        critical: true,
      },
      {
        field: 'offer_amount',
        label: 'Offer Amount Logged',
        check: (lead) => lead.metadata?.offer_amount !== undefined,
        critical: true,
      },
      {
        field: 'offer_document',
        label: 'Offer Document Reference',
        check: (lead) => !!lead.metadata?.offer_document_url,
        critical: false,
      },
    ],
    autoTriggers: ['Contract sent via DocuSeal or manual entry'],
    autoActions: [
      'Lead remains visible in the Opportunities pipeline',
      'Set priority to "hot" if not already',
    ],
    timeoutHours: 72, // 3 days - alert if no response
  },

  // STAGE 5: UNDER CONTRACT
  under_contract: {
    id: 'under_contract',
    number: 5,
    name: 'Under Contract',
    description: 'Signed purchase agreement',
    requirements: [
      {
        field: 'signed_contract',
        label: 'Signed Contract Reference',
        check: (lead) => !!lead.metadata?.signed_contract_url,
        critical: true,
      },
      {
        field: 'earnest_money',
        label: 'Earnest Money Status',
        check: (lead) =>
          ['paid', 'pending', 'waived'].includes(
            typeof lead.metadata?.earnest_money_status === 'string' ? lead.metadata.earnest_money_status : ''
          ),
        critical: true,
      },
      {
        field: 'inspection_date',
        label: 'Inspection Period End Date',
        check: (lead) => !!lead.metadata?.inspection_end_date,
        critical: false,
      },
      {
        field: 'closing_date',
        label: 'Closing Date Set',
        check: (lead) => !!lead.metadata?.closing_date,
        critical: true,
      },
    ],
    autoTriggers: ['Signed purchase agreement recorded'],
    autoActions: [
      'Monitor inspection deadline (flag if <48hrs)',
      'Monitor closing date (flag if <7 days)',
    ],
    timeoutHours: null, // Date-based monitoring instead
  },

  // STAGE 6: DISPOSITION (WHOLESALE)
  disposition: {
    id: 'disposition',
    number: 6,
    name: 'Disposition',
    description: 'Buyer matched, assignment contract initiated',
    requirements: [
      {
        field: 'buyer_info',
        label: 'Buyer Name/Info',
        check: (lead) => !!lead.metadata?.buyer_name,
        critical: true,
      },
      {
        field: 'assignment_fee',
        label: 'Assignment Fee Amount',
        check: (lead) => lead.metadata?.assignment_fee !== undefined,
        critical: true,
      },
      {
        field: 'title_company',
        label: 'Title Company Assigned',
        check: (lead) => !!lead.metadata?.title_company,
        critical: true,
      },
    ],
    autoTriggers: ['Buyer matched and assignment contract initiated'],
    autoActions: [],
    timeoutHours: null,
  },

  // STAGE 7: CLOSED
  closed: {
    id: 'closed',
    number: 7,
    name: 'Closed',
    description: 'Deal closed, settlement complete',
    requirements: [
      {
        field: 'settlement_statement',
        label: 'Settlement Statement Uploaded',
        check: (lead) => !!lead.metadata?.settlement_statement_url,
        critical: true,
      },
      {
        field: 'revenue',
        label: 'Revenue Amount Logged',
        check: (lead) => lead.metadata?.revenue !== undefined,
        critical: true,
      },
      {
        field: 'docs_archived',
        label: 'All Documents Archived',
        check: (lead) => lead.metadata?.docs_archived === true,
        critical: false,
      },
    ],
    autoTriggers: ['Closing confirmed by title company'],
    autoActions: [
      'Update dashboard "Days Since Last Closing" to 0',
      'Log revenue event for financial tracking',
    ],
    timeoutHours: null,
  },

  // STAGE 8: DEAD / NURTURE
  dead: {
    id: 'dead',
    number: 8,
    name: 'Dead / Nurture',
    description: 'Not pursuing actively, enrolled in recycler',
    requirements: [
      {
        field: 'disposition_reason',
        label: 'Reason for Dead Status',
        check: (lead) => !!lead.metadata?.dead_reason,
        critical: true,
      },
    ],
    autoTriggers: [
      'Agent manually marks dead',
      'Max contact attempts with no response',
    ],
    autoActions: [
      'Enroll in dead lead recycler (90/180 day re-evaluation)',
      'Connect to Ghost Protocol',
      'Hide from default pipeline view',
    ],
    timeoutHours: null,
  },
}

// ============================================================================
// STAGE VALIDATION
// ============================================================================

/**
 * Validate if a lead meets the requirements for its current stage
 */
export async function validateLeadStage(
  leadId: string,
  targetStage: StageId
): Promise<StageValidationResult> {
  if (targetStage === 'qualified') {
    const qualification = await getLeadQualificationStatus(leadId)
    return {
      valid: qualification.qualified,
      missing: qualification.missing.map((pillar) => `${pillar} qualification pillar`),
      warnings: [],
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Fetch lead with metadata
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead) {
    return { valid: false, missing: ['Lead not found'], warnings: [] }
  }

  // Check if lead has pillar data in lead_activities
  const { data: pillarData } = await supabase
    .from('lead_activities')
    .select('metadata')
    .eq('lead_id', leadId)
    .eq('type', 'pillar_data')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  // Merge pillar data into lead metadata
  if (pillarData?.metadata) {
    lead.metadata = { ...lead.metadata, ...pillarData.metadata }
  }

  const stageDef = STAGE_DEFINITIONS[targetStage]
  const missing: string[] = []
  const warnings: string[] = []

  for (const req of stageDef.requirements) {
    const passes = req.check(lead)
    if (!passes) {
      if (req.critical) {
        missing.push(req.label)
      } else {
        warnings.push(req.label)
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  }
}

/**
 * Get the next valid stage for a lead
 */
export function getNextStage(currentStage: StageId | null): StageId | null {
  if (!currentStage) return 'new'

  const stageOrder: StageId[] = [
    'new',
    'contacted',
    'qualified',
    'offer_made',
    'under_contract',
    'disposition',
    'closed',
  ]

  const currentIndex = stageOrder.indexOf(currentStage)
  if (currentIndex === -1 || currentIndex === stageOrder.length - 1) {
    return null
  }

  return stageOrder[currentIndex + 1]
}

/**
 * Get the previous stage
 */
export function getPreviousStage(currentStage: StageId): StageId | null {
  const stageOrder: StageId[] = [
    'new',
    'contacted',
    'qualified',
    'offer_made',
    'under_contract',
    'disposition',
    'closed',
  ]

  const currentIndex = stageOrder.indexOf(currentStage)
  if (currentIndex <= 0) return null

  return stageOrder[currentIndex - 1]
}

// ============================================================================
// STAGE TRANSITION
// ============================================================================

export interface StageTransitionData {
  lead_id: string
  from_stage: StageId | null
  to_stage: StageId
  changed_by: string // agent ID or "system"
  reason?: string
  method: 'manual_advance' | 'auto_trigger' | 'agent_override'
}

/**
 * Attempt to advance a lead to the next stage
 * Returns { success: boolean, errors: string[] }
 */
export async function advanceLeadStage(
  leadId: string,
  targetStage: StageId,
  changedBy: string,
  method: 'manual_advance' | 'auto_trigger' | 'agent_override' = 'manual_advance',
  reason?: string
): Promise<{ success: boolean; errors: string[] }> {
  const validation = await validateLeadStage(leadId, targetStage)

  if (!validation.valid && method !== 'agent_override') {
    return {
      success: false,
      errors: validation.missing,
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Get current stage
  const { data: lead } = await supabase
    .from('leads')
    .select('station')
    .eq('id', leadId)
    .single()

  // Map station to StageId (for transition logging)
  const fromStage = lead?.station as StageId | null

  // Update lead stage
  const { error: updateError } = await supabase
    .from('leads')
    .update({ station: targetStage })
    .eq('id', leadId)

  if (updateError) {
    return { success: false, errors: [updateError.message] }
  }

  // Cascade to manifest
  try {
    const { updateManifestAndCascade } = await import('./manifest-sync')
    await updateManifestAndCascade(leadId, (manifest: ManifestV2) => {
      manifest.currentStation = targetStage
      if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
      manifest.ariIntelligence.briefingStale = true
      if (!manifest.auditTrail) manifest.auditTrail = []
      manifest.auditTrail.push({
        timestamp: new Date().toISOString(),
        agent: changedBy,
        action: 'station_changed',
        details: { from: fromStage, to: targetStage, method, reason },
      })
    }, `stage_logic:${method}`)
  } catch (err) {
    console.error('[stage-logic] Manifest cascade failed:', err)
  }

  // Log transition in stage_transitions table (we'll create this)
  await supabase.from('stage_transitions').insert({
    lead_id: leadId,
    from_stage: fromStage,
    to_stage: targetStage,
    changed_by: changedBy,
    reason,
    method,
    created_at: new Date().toISOString(),
  })

  // Execute auto-actions for the new stage
  await executeStageAutoActions(leadId, targetStage)

  const { queuePpcQualifiedLeadConversion } = await import('@/lib/ppc/qualified-lead-conversion')
  await queuePpcQualifiedLeadConversion({
    leadId,
    fromStation: fromStage,
    toStation: targetStage,
    changedBy,
    reason: reason ?? method,
  }).catch((error) => console.error('[stage-logic] PPC qualified conversion queue failed:', error))

  return { success: true, errors: [] }
}

/**
 * Execute auto-actions when a lead enters a stage
 */
async function executeStageAutoActions(leadId: string, stage: StageId) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  switch (stage) {
    case 'new':
      // Create initial follow-up task
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        type: 'task',
        description: 'First contact attempt',
        metadata: {
          task_type: 'callback',
          channel: 'call',
          status: 'pending',
        },
        created_at: new Date().toISOString(),
      })
      break

    case 'offer_made':
      // Set priority to hot
      await supabase
        .from('leads')
        .update({ priority: 'hot' })
        .eq('id', leadId)

      // Cascade to manifest
      try {
        const { updateManifestAndCascade } = await import('./manifest-sync')
        await updateManifestAndCascade(leadId, (manifest: ManifestV2) => {
          manifest.priority = 'hot'
          if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
          manifest.ariIntelligence.briefingStale = true
          if (!manifest.auditTrail) manifest.auditTrail = []
          manifest.auditTrail.push({
            timestamp: new Date().toISOString(),
            agent: 'stage_logic:auto_action',
            action: 'priority_changed',
            details: { reason: 'offer_made_stage' },
          })
        }, 'stage_logic:offer_made')
      } catch (err) {
        console.error('[stage-logic] Manifest cascade failed:', err)
      }
      break

    case 'closed':
      // Log revenue event (to be implemented with financial tracking)
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        type: 'status_change',
        description: 'Deal closed - revenue logged',
        created_at: new Date().toISOString(),
      })
      break

    case 'dead':
      // Enroll in Ghost Protocol if applicable
      // This connects to Night 2's ghost-protocol.ts
      break
  }
}

// ============================================================================
// MIGRATION HELPER
// ============================================================================

/**
 * Migrate any leads without a stage to 'new'
 * Run this once to ensure all leads have a valid stage
 */
export async function migrateLeadsWithoutStage(): Promise<{
  updated: number
  errors: string[]
}> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data: leadsWithoutStage } = await supabase
    .from('leads')
    .select('id')
    .is('station', null)

  if (!leadsWithoutStage || leadsWithoutStage.length === 0) {
    return { updated: 0, errors: [] }
  }

  const { error } = await supabase
    .from('leads')
    .update({ station: 'new' })
    .is('station', null)

  if (error) {
    return { updated: 0, errors: [error.message] }
  }

  // Cascade to manifests for all updated leads
  try {
    const { updateManifestAndCascade } = await import('./manifest-sync')
    for (const lead of leadsWithoutStage) {
      await updateManifestAndCascade(lead.id, (manifest: ManifestV2) => {
        manifest.currentStation = 'new'
        if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
        manifest.ariIntelligence.briefingStale = true
        if (!manifest.auditTrail) manifest.auditTrail = []
        manifest.auditTrail.push({
          timestamp: new Date().toISOString(),
          agent: 'stage_logic:migration',
          action: 'station_initialized',
          details: { reason: 'migration_without_stage' },
        })
      }, 'stage_logic:migration')
    }
  } catch (err) {
    console.error('[stage-logic] Manifest cascade failed during migration:', err)
  }

  return { updated: leadsWithoutStage.length, errors: [] }
}
