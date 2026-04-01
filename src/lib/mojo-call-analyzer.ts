/** Stub — analyze call transcript with AI */
export interface CallAnalysisResult {
  summary?: string
  aiSummary?: string
  sentiment?: 'positive' | 'neutral' | 'negative' | null
  nextSteps?: string[]
  isHotLead?: boolean
  motivationScore?: number
  rapportLevel?: 'high' | 'medium' | 'low' | null
  verbatimQuotes?: string[]
  objectionsRaised?: string[]
  keyLeverage?: string[]
  agentStrengths?: string[]
  agentImprovements?: string[]
  bestTimeToContact?: string
  personalityType?: string
  communicationStyle?: string
  decisionStyle?: string
  coOwners?: string[]
  outOfState?: boolean
  alternatePhonesFound?: string[]
  vacant?: boolean
  occupancy?: string
  conditionOverall?: string
  repairsNotes?: string
  situationType?: string[]
  motivationSignals?: string[]
  urgency?: string
  targetCloseDate?: string
  hardDeadline?: boolean
  deadlineReason?: string
  sellerAsking?: number
  sellerFloor?: number
  priceFlexibility?: string
  priceAnchor?: string
  blockers?: string[]
  emotionalDrivers?: string[]
  dealConfidenceScore?: number
  estimatedARV?: number
  estimatedRepairsNotes?: string
  followUpAction?: string
  followUpDateTime?: string
  appointmentDateTime?: string
  appointmentType?: string
  [key: string]: unknown
}

export async function analyzeCallTranscript(_transcript: string, _manifest?: unknown): Promise<CallAnalysisResult> {
  throw new Error('mojo-call-analyzer not yet implemented')
}
