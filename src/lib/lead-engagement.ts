export type LeadEngagementActivity = {
  activity_type: string
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export type LeadEngagementVerdict = 'favorite' | 'likely_favorite' | 'unclear' | 'likely_fool' | 'fool'

export type LeadEngagementAssessment = {
  verdict: LeadEngagementVerdict
  label: string
  favoriteSignals: string[]
  foolSignals: string[]
  recommendation: string
}

type LeadEngagementInput = {
  station?: string | null
  source?: string | null
  isFavorite?: boolean | null
  notes?: string | null
  sellerSituation?: string | null
  motivationScore?: number | null
  appointment?: { scheduledAt: string } | null
  activities?: LeadEngagementActivity[]
}

const PREFERENCE_PATTERN = /\b(want(?:s|ed)? to work with (?:us|you)|chose (?:us|you)|trust(?:s|ed)? (?:us|you)|ready to move forward with (?:us|you)|savingkc is the right fit|heard good things|recommend(?:ed)?)\b/i
const MARKETING_PATTERN = /\b(your (?:letter|card|mailer|postcard)|got your|saw your (?:ad|sign)|savingkc ad)\b/i
const RETURNED_CONTACT_PATTERN = /\b(called back|returned (?:the |our )?call|replied|responded|texted back)\b/i
const SHOPPING_PATTERN = /\b(other buyer|another buyer|other offer|another offer|shopping around|comparing offers|listed with (?:a )?realtor)\b/i
const PRICE_ONLY_PATTERN = /\b(best offer|highest offer|just (?:give|send) me (?:a )?(?:number|price)|what can you (?:give|pay)|how much will you pay)\b/i
const NO_COMMITMENT_PATTERN = /\b(just looking|no rush|not sure when|won't commit|will not commit)\b/i
const GHOSTING_PATTERN = /\b(ghosting|no response|won't answer|will not answer|stopped responding)\b/i

function textValues(value: unknown, depth = 0): string[] {
  if (depth > 2) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.slice(0, 20).flatMap((item) => textValues(item, depth + 1))
  if (!value || typeof value !== 'object') return []
  return Object.values(value as Record<string, unknown>).slice(0, 40).flatMap((item) => textValues(item, depth + 1))
}

function activityText(activity: LeadEngagementActivity): string {
  return [activity.description || '', ...textValues(activity.metadata)].join(' ').replace(/\s+/g, ' ').trim()
}

function activityDirection(activity: LeadEngagementActivity): string {
  const direction = typeof activity.metadata?.direction === 'string' ? activity.metadata.direction.toLowerCase() : ''
  if (direction) return direction
  const type = activity.activity_type.toLowerCase()
  if (type.includes('received') || type.includes('inbound')) return 'inbound'
  if (type.includes('sent') || type.includes('outbound')) return 'outbound'
  return ''
}

function unique(values: string[]) {
  return [...new Set(values)]
}

export function assessFavoriteOrFool(input: LeadEngagementInput): LeadEngagementAssessment {
  const activities = input.activities ?? []
  const combinedText = [input.notes || '', input.sellerSituation || '', ...activities.map(activityText)].join(' ')
  const inboundCount = activities.filter((activity) => activityDirection(activity) === 'inbound').length
  const outboundCount = activities.filter((activity) => activityDirection(activity) === 'outbound').length
  const favoriteSignals: string[] = []
  const foolSignals: string[] = []
  let favoriteWeight = 0
  let foolWeight = 0

  if (PREFERENCE_PATTERN.test(combinedText)) {
    favoriteWeight += 5
    favoriteSignals.push('Seller language indicates trust or a preference to work with SavingKC.')
  }
  if (input.appointment) {
    favoriteWeight += 3
    favoriteSignals.push('Seller committed time to an appointment.')
  }
  if (inboundCount > 0) {
    favoriteWeight += 2
    favoriteSignals.push(`${inboundCount} inbound seller response${inboundCount === 1 ? '' : 's'} recorded.`)
  }
  if (RETURNED_CONTACT_PATTERN.test(combinedText)) {
    favoriteWeight += 2
    favoriteSignals.push('Seller returned or answered a follow-up.')
  }
  if (MARKETING_PATTERN.test(combinedText)) {
    favoriteWeight += 1
    favoriteSignals.push('Seller referenced SavingKC marketing.')
  }
  if (/\b(high|strong|excellent) rapport\b|\bpositive sentiment\b|\bconcession signal/i.test(combinedText)) {
    favoriteWeight += 2
    favoriteSignals.push('Conversation evidence shows rapport or movement toward agreement.')
  }
  if (/\b(inbound_call|inbound_text|web_form|ppc|website_form)\b/i.test(input.source || '')) {
    favoriteWeight += 1
    favoriteSignals.push('Seller entered through an inbound channel.')
  }
  if ((input.motivationScore ?? 0) >= 8) {
    favoriteWeight += 1
    favoriteSignals.push('High seller motivation is recorded.')
  }
  if (input.isFavorite) {
    favoriteSignals.push('A rep marked this lead as a priority favorite.')
  }

  if (SHOPPING_PATTERN.test(combinedText)) {
    foolWeight += 5
    foolSignals.push('Notes or conversation evidence mention competing buyers or offers.')
  }
  if (PRICE_ONLY_PATTERN.test(combinedText)) {
    foolWeight += 3
    foolSignals.push('Seller language is focused on extracting a number or best offer.')
  }
  if (NO_COMMITMENT_PATTERN.test(combinedText)) {
    foolWeight += 2
    foolSignals.push('No clear timing or commitment is recorded.')
  }
  if (GHOSTING_PATTERN.test(combinedText)) {
    foolWeight += 2
    foolSignals.push('The record says the seller stopped responding.')
  }
  if (outboundCount >= 3 && inboundCount === 0) {
    foolWeight += 1
    foolSignals.push(`${outboundCount} outbound attempts are recorded without an inbound response.`)
  }

  const favorite = unique(favoriteSignals)
  const fool = unique(foolSignals)

  if (favoriteWeight >= 5 && favoriteWeight >= foolWeight + 2) {
    return {
      verdict: 'favorite',
      label: 'We are the favorite',
      favoriteSignals: favorite,
      foolSignals: fool,
      recommendation: 'Protect the relationship and confirm what makes SavingKC the right fit.',
    }
  }
  if (favoriteWeight >= 3 && favoriteWeight > foolWeight) {
    return {
      verdict: 'likely_favorite',
      label: 'Leaning favorite',
      favoriteSignals: favorite,
      foolSignals: fool,
      recommendation: 'Confirm the preference: “What would make you comfortable moving forward with us?”',
    }
  }
  if (foolWeight >= 5 && foolWeight >= favoriteWeight + 2) {
    return {
      verdict: 'fool',
      label: 'Fool risk is high',
      favoriteSignals: favorite,
      foolSignals: fool,
      recommendation: 'Do not negotiate against yourself. Ask what will decide who they sell to besides price.',
    }
  }
  if (foolWeight >= 3 && foolWeight > favoriteWeight) {
    return {
      verdict: 'likely_fool',
      label: 'Leaning fool',
      favoriteSignals: favorite,
      foolSignals: fool,
      recommendation: 'Test commitment before investing more rep time.',
    }
  }
  return {
    verdict: 'unclear',
    label: 'Still unclear',
    favoriteSignals: favorite,
    foolSignals: fool,
    recommendation: 'Ask the proof-of-life question: “Why would you want to work with us?”',
  }
}
