// Hot Opportunity types for UI rendering

export type HotTierLabel = 'favorite' | 'caution' | 'long_shot'

export interface HotScoreBreakdown {
  engagement: number
  velocity: number
  dealQuality: number
  timePressure: number
  multiplier: number
  composite: number
  tierLabel: HotTierLabel
  tierCapped: boolean
}

export interface HotOpportunityData {
  // Cache data
  leadId: string
  rank: number
  score: HotScoreBreakdown
  lastScoredAt: string
  triggerEvent?: string

  // Manifest-derived card data
  address?: string
  city?: string
  county?: string
  sellerName?: string
  currentStation: string
  leadSource?: string
  leadAge?: string
  assignedAgent?: string

  // Ari signals
  hotSignal?: string
  hotSignalSource?: string
  hotNextMove?: string

  // Flag pills
  flags: {
    hasDeadline: boolean
    deadlineDate?: string
    hasLifeEvent: boolean
    lifeEventType?: string
    hasCompetingOffer: boolean
    competingOfferSpecificity?: 'specific' | 'vague'
  }

  // Motivation trend
  motivationHistory: Array<{ callDate: string; level: 'cold' | 'warm' | 'hot' }>

  // Deal math (5-col grid)
  dealMath: {
    arv?: number
    arvSource?: string
    asIsValue?: number
    askingPrice?: number
    offerAmount?: number
    spread?: number
    spreadHealthy: boolean
    repairEstimate?: number
    repairSource?: string
  }

  // Data completeness
  missingFields: string[]

  // Contact history
  lastCallDate?: string
  lastTextDate?: string
  lastEmailDate?: string
  lastMailDate?: string

  // Cooling indicator
  coolingIndicator?: {
    responsePending: boolean
    daysSinceResponse: number
    attemptsSinceResponse: number
  }

  // Cadence health (per channel)
  cadenceHealth: {
    call: 'green' | 'amber' | 'red' | 'gray'
    text: 'green' | 'amber' | 'red' | 'gray'
    email: 'green' | 'amber' | 'red' | 'gray'
    mail: 'green' | 'amber' | 'red' | 'gray'
  }

  // Phone for quick actions
  phone?: string
}
