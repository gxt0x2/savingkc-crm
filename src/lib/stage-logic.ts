/**
 * Canonical lifecycle stage definitions.
 *
 * Mutations are governed by `applyCrmLifecycleCommand`; this module is data-only
 * so timeout reporting and other readers cannot bypass that command boundary.
 */

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
