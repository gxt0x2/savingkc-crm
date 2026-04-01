/**
 * Analyze call transcript with AI to extract seller intelligence.
 * Uses Groq Llama 3.3 70B for fast, free analysis.
 */
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

export async function analyzeCallTranscript(
  transcript: string,
  _manifest?: unknown,
): Promise<CallAnalysisResult> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not configured')
  }

  // Truncate very long transcripts to fit in context
  const maxChars = 12000
  const truncatedTranscript = transcript.length > maxChars
    ? transcript.slice(0, maxChars) + '\n... [transcript truncated]'
    : transcript

  const prompt = `You are an expert real estate wholesaling call analyst for Saving KC Homebuyers in Kansas City. Analyze this seller call transcript and extract structured intelligence.

TRANSCRIPT:
${truncatedTranscript}

Respond in JSON with these fields (skip any field where there's no data):
{
  "aiSummary": "3-5 sentence summary of the call — what happened, key takeaways, what the seller said",
  "sentiment": "positive | neutral | negative",
  "motivationScore": 1-10 (how motivated is the seller to sell?),
  "rapportLevel": "low | medium | high",
  "verbatimQuotes": ["exact seller quotes that reveal motivation, pain, or price expectations — up to 5"],
  "objectionsRaised": ["specific objections or concerns the seller expressed"],
  "keyLeverage": ["leverage points we can use — tax issues, repairs needed, timeline pressure, etc"],
  "emotionalDrivers": ["what's emotionally driving this seller — fear, frustration, relief, etc"],
  "agentStrengths": ["what the agent did well on this call"],
  "agentImprovements": ["what the agent could improve next time"],
  "personalityType": "accommodator | assertive | analyst (the seller's negotiation personality)",
  "communicationStyle": "brief description of how the seller communicates",
  "decisionStyle": "how the seller makes decisions — impulsive, consensus-driven, analytical, etc",
  "bestTimeToContact": "if mentioned, when is best to reach them",
  "situationType": ["tags: inherited, tax_delinquent, vacant, divorce, relocation, repairs_needed, financial_distress, etc"],
  "motivationSignals": ["specific signals: mentioned deadline, asked about timeline, expressed urgency, etc"],
  "urgency": "low | medium | high | critical",
  "sellerAsking": null or number if they mentioned a price,
  "sellerFloor": null or number if they mentioned a minimum,
  "priceFlexibility": "none | low | medium | high",
  "priceAnchor": "what their price expectation is based on — Zillow, tax assessment, neighbor sold, etc",
  "conditionOverall": "excellent | good | fair | poor | uninhabitable (if property condition discussed)",
  "repairsNotes": "specific repairs mentioned during the call",
  "blockers": ["anything blocking the deal — probate, co-owner disagreement, tenant, etc"],
  "coOwners": ["names of co-owners mentioned"],
  "outOfState": true/false if the seller lives out of state,
  "vacant": true/false if the property is vacant,
  "occupancy": "owner | tenant | vacant (if discussed)",
  "hardDeadline": true/false,
  "deadlineReason": "why there's a deadline (tax sale, foreclosure, etc)",
  "targetCloseDate": "if they mentioned when they want to close",
  "followUpAction": "recommended next step",
  "followUpDateTime": "when to follow up if mentioned",
  "appointmentDateTime": "if an appointment was set",
  "appointmentType": "discovery | walkthrough | closing",
  "dealConfidenceScore": 1-100 (how likely is this deal to close?),
  "nextSteps": ["ordered list of next actions"],
  "isHotLead": true/false
}

Be specific. Use actual numbers and quotes from the transcript. Don't make up data that isn't in the call.`

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.3,
    }),
  })

  if (!res.ok) {
    throw new Error(`Groq API error: ${res.status}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || ''

  try {
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return parsed as CallAnalysisResult
    }
  } catch (e) {
    console.error('Failed to parse call analysis JSON:', e)
  }

  // Fallback: return the raw text as summary
  return {
    aiSummary: content.slice(0, 1000),
    sentiment: null,
  }
}
