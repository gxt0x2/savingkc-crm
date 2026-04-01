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

export interface ManifestPipeline {
  intake: { status: 'pending' | 'in_progress' | 'completed'; completedAt?: string; notes?: string }
  qualifying: { status: 'pending' | 'in_progress' | 'completed'; completedAt?: string; notes?: string }
  discovery: { status: 'pending' | 'in_progress' | 'completed'; completedAt?: string; notes?: string }
  research: { status: 'pending' | 'in_progress' | 'completed'; completedAt?: string; notes?: string }
  valuation: { status: 'pending' | 'in_progress' | 'completed'; completedAt?: string; notes?: string }
  offer: { status: 'pending' | 'in_progress' | 'completed'; completedAt?: string; notes?: string }
  negotiations: { status: 'pending' | 'in_progress' | 'completed'; completedAt?: string; notes?: string }
  contract: { status: 'pending' | 'in_progress' | 'completed'; completedAt?: string; notes?: string }
  inspection: { status: 'pending' | 'in_progress' | 'completed'; completedAt?: string; notes?: string }
  closing_prep: { status: 'pending' | 'in_progress' | 'completed'; completedAt?: string; notes?: string }
  closing: { status: 'pending' | 'in_progress' | 'completed'; completedAt?: string; notes?: string }
  closed: { status: 'pending' | 'in_progress' | 'completed'; completedAt?: string; notes?: string }
  appointment?: {
    dateTime?: string
    type?: string
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
  details?: any
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
