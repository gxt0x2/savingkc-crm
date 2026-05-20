// Lead Manifest V2 Builder
// Constructs comprehensive manifest objects for lead tracking

export interface ManifestOwner {
  firstName: string
  lastName?: string
  fullName: string
  phones: string[]
  emails: string[]
  contactPreference?: 'phone' | 'email' | 'text'
  bestTimeToContact?: string
  relationshipToProperty?: string
  deceased?: boolean
  outOfState?: boolean
  personalityType?: 'accommodator' | 'assertive' | 'analyst' | null
  coOwners?: string[]
}

export interface ManifestSituation {
  summary?: string
  type: string[] // e.g., ["inherited", "vacant", "tax_delinquent"]
  motivation?: {
    primary?: string
    secondary?: string[]
    urgencyLevel?: 'low' | 'medium' | 'high' | 'critical'
    score?: number
    signals?: string[]
  }
  timeline?: {
    preferredClosing?: string
    flexibility?: 'very_flexible' | 'flexible' | 'somewhat_flexible' | 'not_flexible'
    constraints?: string[]
    urgency?: 'low' | 'medium' | 'high' | 'critical'
    targetCloseDate?: string
    hardDeadline?: boolean
    deadlineReason?: string
    sellerDeadline?: string
    sellerDeadlineVerified?: boolean
    foreclosureWindowDays?: number
    competingOffersPresent?: boolean
    competingOfferSpecificity?: 'specific' | 'vague'
    competingOfferDetails?: string
    lifeEventType?: 'divorce' | 'probate' | 'relocation' | 'health' | 'other'
    lifeEventStage?: 'mentioned' | 'active_resolution'
  }
  priceExpectations?: {
    askingPrice?: number
    minimumAcceptable?: number
    basis?: string // e.g., "zillow estimate", "tax assessment", "recent appraisal"
    sellerAsking?: number
    sellerFloor?: number
    priceFlexibility?: 'none' | 'low' | 'medium' | 'high'
    priceAnchor?: string
  }
  objections?: string[]
  blockers?: string[]
}

export interface ManifestProperty {
  address?: string
  parcel?: string
  vacant?: boolean
  occupancy?: 'owner' | 'tenant' | 'vacant' | null
  assessment?: {
    landValue?: number
    improvementValue?: number
    totalValue?: number
    appraisedTotal?: number
    assessedTotal?: number
    year?: number
    assessmentYear?: number
    source?: string
    fetchedAt?: string
  }
  taxCollector?: {
    totalOwed?: number
    delinquentAmount?: number
    currentAmount?: number
    currentAmountDue?: number
    pastYearsDue?: number
    lastPaymentDate?: string
    taxStatus?: string
    delinquentYears?: string
    yearsDelinquent?: number
    source?: string
    fetchedAt?: string
  }
  dwelling?: {
    sqft?: number
    bedrooms?: number
    bathrooms?: number
    yearBuilt?: number
    style?: string
    propertyType?: string
    basement?: string
    finishedBasementSqft?: number
    totalBasementSqft?: number
    garageSize?: number
    exterior?: string
    roofType?: string
    hvac?: string
    hasFireplace?: boolean
    totalRooms?: number
    source?: string
    fetchedAt?: string
  }
  condition?: {
    overall?: 'excellent' | 'good' | 'fair' | 'poor' | 'uninhabitable'
    roof?: string
    foundation?: string
    hvac?: string
    electrical?: string
    plumbing?: string
    notes?: string
  }
}

export interface ManifestBooking {
  scheduledDate?: string
  scheduledTime?: string
  type?: 'discovery' | 'walkthrough' | 'closing'
  confirmedAt?: string
}

export interface ManifestFinancials {
  arv?: number               // After-repair value
  as_is_value?: number       // Current as-is value
  repair_estimate?: number   // Estimated repair cost
  asking_price?: number      // What the seller wants
  offer_amount?: number      // Our offer
  assignment_fee?: number    // Wholesale spread
  mortgage_balance?: number  // Remaining mortgage
  back_taxes?: number        // Owed to county
  liens_amount?: number      // Liens on property
  equity?: number            // Computed: arv - total_debt
  total_debt?: number        // Computed: mortgage + taxes + liens
  arv_source?: 'comps' | 'zestimate' | 'desktop' | 'agent_opinion'
  arv_date?: string
  as_is_value_source?: 'comps' | 'zestimate' | 'agent_opinion'
  repair_estimate_source?: 'contractor_bid' | 'desktop'
  offer_status?: 'pending_send' | 'submitted' | 'tbd' | 'needs_walkthrough'
  spread?: number            // Computed: arv - offer_amount - repair_estimate
}

export interface ManifestDeal {
  offerRange?: {
    min: number
    max: number
  }
  assignmentFee?: number
  contractPrice?: number
  status?: 'none' | 'verbal' | 'written' | 'signed' | 'closed'
}

export interface PipelineStage {
  status: 'pending' | 'in_progress' | 'completed'
  completedAt?: string
  notes?: string
  enteredAt?: string
}

export interface ManifestPipeline {
  intake: PipelineStage
  qualifying: PipelineStage
  discovery: PipelineStage
  research: PipelineStage
  valuation: PipelineStage
  offer: PipelineStage
  negotiations: PipelineStage
  contract: PipelineStage
  inspection: PipelineStage
  closing_prep: PipelineStage
  closing: PipelineStage
  closed: PipelineStage
  appointment?: {
    appointmentId: string           // UUID, generated on creation
    type: 'phone_call' | 'in_person' | 'google_meet'
    scheduledAt: string             // ISO 8601 datetime
    createdAt: string               // ISO 8601
    status: 'scheduled' | 'confirmed' | 'reconfirmed' | 'completed' | 'no_show' | 'cancelled' | 'rescheduled'
    confirmationCount: number       // default 0
    lastSellerResponse: string | null  // ISO 8601 or null
    ghostRiskScore: number          // 0-100, default 0
    ghostProtocolActive: boolean    // default false
    reminderAutomationEnabled?: boolean
    reminderAutomationEnabledAt?: string
    reminderAutomationSource?: string
    automationLog: Array<{
      timestamp: string
      action: string
      channel: 'sms' | 'voice' | 'email'
      sellerResponded: boolean
    }>
    assignedTo: string              // 'casey' | 'ernest' | agent ID
    address: string | null          // required for in_person
    notes: string | null            // context from booking call
    calendarEventId?: string        // Google Calendar event ID (Sprint 2)
  }
}

export interface ManifestContact {
  name: string
  role: string
  phone?: string
  email?: string
  notes?: string
}

export interface ManifestFlags {
  redFlags?: string[]
  opportunityFlags?: string[]
}

export interface ManifestNote {
  timestamp: string
  author: string
  content: string
  type?: 'general' | 'important' | 'follow_up'
}

export interface ManifestAuditEntry {
  timestamp: string
  agent: string
  action: string
  details?: unknown
}

export interface ManifestAgentNote {
  timestamp: string
  author: string
  source: string
  content: string
  callRecordId?: string
}

export interface TranscriptEntry {
  id: string
  date: string
  duration: number
  agent: string
  recordingUrl: string | null
  fullTranscript: string | null
  transcriptionPending?: boolean
  analysisPending?: boolean
  aiSummary: string | null
  extractedData?: {
    motivationScore?: number
    sentiment?: 'positive' | 'neutral' | 'negative' | null
    rapportLevel?: 'low' | 'medium' | 'high' | null
    talkRatio?: number | null
    verbatimQuotes?: string[]
    objectionResponses?: string[]
    concessionSignals?: string[]
    agentCoaching?: {
      strengths?: string[]
      improvements?: string[]
    }
  } | null
  agentNotes?: string
}

export interface ManifestCommunications {
  transcripts: TranscriptEntry[]
  lastSellerContactDate?: string
  lastInboundDate?: string
  lastOutboundDate?: string
  lastDisposition?: string
  lastDispositionDate?: string
  responsePending?: boolean
  lastConversationCloser?: 'agent' | 'seller'
  conversationCloseType?: 'sign_off' | 'question' | 'request' | 'initial_outreach'
  totalInboundContacts?: number
  totalTouchpoints?: number
  cadenceGapDetected?: boolean
  outreachAttemptsSinceLastResponse?: number
  daysSinceLastSellerResponse?: number
  thankYouSms?: {
    sent: boolean
    sentAt?: string
    template?: string
    to?: string
  }
}

export interface SellerProfile {
  personalityType?: string
  communicationStyle?: string
  decisionStyle?: string
  emotionalDrivers?: string[]
}

export interface DealIntelligence {
  keyLeverage?: string[]
  confidenceScore?: number
  estimatedARV?: number | null
  estimatedRepairs?: string | null
}

export interface RecommendedAction {
  action: string
  dateTime?: string
  reason?: string
}

export interface ManifestAriIntelligence {
  sellerProfile?: SellerProfile
  dealIntelligence?: DealIntelligence
  recommendedActions?: RecommendedAction[]
  briefingStale?: boolean
  lastBriefing?: {
    situation: string
    motivation: string
    strategy: string
    generatedAt: string
    generatedFrom: string[]
  }
  hotSignal?: string
  hotNextMove?: string
  hotSignalGeneratedAt?: string
}

export interface ManifestScoring {
  opportunity_score: number
  classification: 'opportunity' | 'lead' | 'dead'
  reasoning: string
  worth_enriching: boolean
  scored_at: string
  scored_by: 'ai' | 'disposition' | 'notes'
}

export interface ManifestClosing {
  tc_file_id?: string | null
  title_company?: string | null
  title_contact?: {
    name?: string | null
    role?: string | null
    email?: string | null
    phone?: string | null
  } | null
  file_number?: string | null
  status?: string | null
  risk_level?: string | null
  closing_scheduled_at?: string | null
  emd_confirmed_at?: string | null
  hud_received_at?: string | null
  next_action?: string | null
}

export interface ManifestV2 {
  manifestId: string
  version: 2
  created: string
  lastUpdated: string
  lastUpdatedBy: string
  source: string
  currentStation: string
  priority: 'hot' | 'warm' | 'cold'
  tier?: 'cream' | 'hot' | 'warm' | 'cool' | 'dead'
  qualificationScore?: number
  owner: ManifestOwner
  situation: ManifestSituation
  property: ManifestProperty
  booking: ManifestBooking
  deal: ManifestDeal
  financials?: ManifestFinancials
  pipeline: ManifestPipeline
  contacts: ManifestContact[]
  flags: ManifestFlags
  notes: ManifestNote[]
  auditTrail: ManifestAuditEntry[]
  agentNotes?: ManifestAgentNote[]
  communications?: ManifestCommunications
  ariIntelligence?: ManifestAriIntelligence
  assignedAgent?: string
  leadSource?: string
  leadCreatedDate?: string
  motivationHistory?: Array<{ callDate: string; level: 'cold' | 'warm' | 'hot'; callId?: string }>
  lastCallDate?: string
  lastTextDate?: string
  lastEmailDate?: string
  lastMailDate?: string
  dispositionTier?: number
  scoring?: ManifestScoring
  closing?: ManifestClosing
  acquisition?: ManifestAcquisition
}

export interface ManifestAcquisition {
  source?: string
  channel?: string
  subChannel?: string
  attribution?: {
    utm_source?: string
    utm_medium?: string
    utm_campaign?: string
    utm_term?: string
    utm_content?: string
    gclid?: string
    referrer?: string
    landingUrl?: string
    capturedAt?: string
  }
}

export interface BuildManifestInput {
  firstName: string
  lastName?: string
  phone?: string
  email?: string
  propertyAddress?: string
  source?: string
  bookingId?: string
  leadId?: string
  slotDate?: string
  slotTime?: string
  station?: string
  priority?: 'hot' | 'warm' | 'cold'
}

export function buildManifest(input: BuildManifestInput): ManifestV2 {
  const now = new Date().toISOString()
  const dateStr = new Date().toISOString().split('T')[0]
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase()
  const manifestId = `MAN-${dateStr}-${randomSuffix}`

  const fullName = input.lastName
    ? `${input.firstName} ${input.lastName}`
    : input.firstName

  const manifest: ManifestV2 = {
    manifestId,
    version: 2,
    created: now,
    lastUpdated: now,
    lastUpdatedBy: 'system:booking',
    source: input.source || 'website_form',
    currentStation: input.station || 'intake',
    priority: input.priority || 'hot',
    tier: undefined,
    qualificationScore: undefined,

    owner: {
      firstName: input.firstName,
      lastName: input.lastName,
      fullName,
      phones: input.phone ? [input.phone] : [],
      emails: input.email ? [input.email] : [],
      contactPreference: undefined,
      bestTimeToContact: undefined,
      relationshipToProperty: undefined,
      deceased: false,
      outOfState: false,
    },

    situation: {
      summary: undefined,
      type: [],
      motivation: {
        primary: undefined,
        secondary: [],
        urgencyLevel: undefined,
      },
      timeline: {
        preferredClosing: undefined,
        flexibility: undefined,
        constraints: [],
      },
      priceExpectations: {
        askingPrice: undefined,
        minimumAcceptable: undefined,
        basis: undefined,
      },
      objections: [],
      blockers: [],
    },

    property: {
      address: input.propertyAddress || undefined,
      parcel: undefined,
      assessment: {
        landValue: undefined,
        improvementValue: undefined,
        totalValue: undefined,
        year: undefined,
      },
      taxCollector: {
        delinquentAmount: undefined,
        currentAmount: undefined,
        lastPaymentDate: undefined,
      },
      dwelling: {
        sqft: undefined,
        bedrooms: undefined,
        bathrooms: undefined,
        yearBuilt: undefined,
        style: undefined,
      },
      condition: {
        overall: undefined,
        roof: undefined,
        foundation: undefined,
        hvac: undefined,
        electrical: undefined,
        plumbing: undefined,
        notes: undefined,
      },
    },

    booking: {
      scheduledDate: input.slotDate,
      scheduledTime: input.slotTime,
      type: 'discovery',
      confirmedAt: now,
    },

    deal: {
      offerRange: undefined,
      assignmentFee: undefined,
      contractPrice: undefined,
      status: 'none',
    },

    financials: {},

    pipeline: {
      intake: { status: 'completed', completedAt: now, notes: 'Lead captured via booking' },
      qualifying: { status: 'pending' },
      discovery: { status: 'pending' },
      research: { status: 'pending' },
      valuation: { status: 'pending' },
      offer: { status: 'pending' },
      negotiations: { status: 'pending' },
      contract: { status: 'pending' },
      inspection: { status: 'pending' },
      closing_prep: { status: 'pending' },
      closing: { status: 'pending' },
      closed: { status: 'pending' },
    },

    contacts: [],

    flags: {
      redFlags: [],
      opportunityFlags: [],
    },

    notes: [],

    agentNotes: [],

    communications: {
      transcripts: [],
    },

    ariIntelligence: {
      sellerProfile: {},
      dealIntelligence: {},
      recommendedActions: [],
      briefingStale: false,
    },

    auditTrail: [
      {
        timestamp: now,
        agent: 'system:booking',
        action: 'manifest_created',
        details: {
          source: input.source,
          bookingId: input.bookingId,
          leadId: input.leadId,
        },
      },
    ],
  }

  return manifest
}
