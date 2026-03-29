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
}

export interface ManifestSituation {
  summary?: string
  type: string[] // e.g., ["inherited", "vacant", "tax_delinquent"]
  motivation?: {
    primary?: string
    secondary?: string[]
    urgencyLevel?: 'low' | 'medium' | 'high' | 'critical'
  }
  timeline?: {
    preferredClosing?: string
    flexibility?: 'very_flexible' | 'flexible' | 'somewhat_flexible' | 'not_flexible'
    constraints?: string[]
  }
  priceExpectations?: {
    askingPrice?: number
    minimumAcceptable?: number
    basis?: string // e.g., "zillow estimate", "tax assessment", "recent appraisal"
  }
  objections?: string[]
  blockers?: string[]
}

export interface ManifestProperty {
  address?: string
  parcel?: string
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

export interface ManifestV2 {
  manifestId: string
  version: 2
  created: string
  lastUpdated: string
  lastUpdatedBy: string
  source: string
  currentStation: string
  priority: 'hot' | 'warm' | 'cold'
  tier?: 'A' | 'B' | 'C' | 'D'
  qualificationScore?: number
  owner: ManifestOwner
  situation: ManifestSituation
  property: ManifestProperty
  booking: ManifestBooking
  deal: ManifestDeal
  pipeline: ManifestPipeline
  contacts: ManifestContact[]
  flags: ManifestFlags
  notes: ManifestNote[]
  auditTrail: ManifestAuditEntry[]
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
