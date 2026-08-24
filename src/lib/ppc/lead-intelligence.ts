import {
  CONDITION_TO_OVERALL,
  SITUATION_TO_TAG,
  TIMELINE_TO_URGENCY,
} from '@/lib/ppc/tracking-events'

export type PpcSituation = keyof typeof SITUATION_TO_TAG
export type PpcTimeline = keyof typeof TIMELINE_TO_URGENCY
export type PpcCondition = keyof typeof CONDITION_TO_OVERALL
export type PpcAuctionStatus = 'yes' | 'no' | 'not-sure'

export type PpcLeadIntelligenceInput = {
  source?: string | null
  formStatus?: 'potential_no_submit' | 'stage_3_complete_no_submit' | 'submitted' | string | null
  situation?: PpcSituation | null
  timeline?: PpcTimeline | null
  condition?: PpcCondition | null
  auctionStatus?: PpcAuctionStatus | null
  address?: string | null
  addressSource?: string | null
  fullName?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  county?: string | null
  attribution?: Record<string, unknown> | null
  capturedAt?: string | null
}

export type PpcLeadIntelligenceResult = {
  sellerSituation: string | null
  motivationScore: number | null
  changed: string[]
}

const SITUATION_LABELS: Record<PpcSituation, string> = {
  'tax-delinquent': 'Tax delinquency or tax sale concern',
  inherited: 'Inherited property',
  'tired-landlord': 'Tired landlord',
  condition: 'Property condition is the issue',
  'life-event': 'Life event driving the sale',
  'redemption-window': 'Tax-sale redemption window',
  'redemption-not-sure': 'Redemption help needed',
  'excess-proceeds': 'Excess proceeds claim',
  'excess-not-sure': 'Excess proceeds check requested',
  other: 'Seller is exploring selling options',
}

const TIMELINE_DETAILS: Record<PpcTimeline, { label: string; baseScore: number }> = {
  asap: { label: 'ASAP', baseScore: 8 },
  '60-days': { label: 'Within 60 days', baseScore: 6 },
  flexible: { label: 'Flexible', baseScore: 4 },
  exploring: { label: 'Exploring options', baseScore: 3 },
}

const CONDITION_DETAILS: Record<PpcCondition, { label: string; scoreBump: number }> = {
  good: { label: 'Good condition', scoreBump: 0 },
  'needs-work': { label: 'Property needs work', scoreBump: 1 },
  'major-repair': { label: 'Major repairs needed', scoreBump: 2 },
  vacant: { label: 'Property is vacant', scoreBump: 2 },
  'redeem-payoff': { label: 'Needs redemption payoff amount', scoreBump: 1 },
  'redeem-title': { label: 'Needs title help during redemption', scoreBump: 1 },
  'redeem-cash': { label: 'Needs cash to redeem', scoreBump: 2 },
  'redeem-sell': { label: 'Wants to sell instead of redeem', scoreBump: 2 },
  'proceeds-claim': { label: 'Needs excess-proceeds claim filed', scoreBump: 1 },
  'proceeds-heirs': { label: 'Multiple heirs or owners involved', scoreBump: 1 },
  'proceeds-liens': { label: 'Lien or title questions on proceeds', scoreBump: 1 },
  'proceeds-cash-now': { label: 'Interested in cash-now proceeds option', scoreBump: 2 },
}

const AUCTION_DETAILS: Record<PpcAuctionStatus, { label: string; scoreBump: number }> = {
  yes: { label: 'Auction status: yes', scoreBump: 2 },
  no: { label: 'Auction status: no', scoreBump: 0 },
  'not-sure': { label: 'Auction status: not sure', scoreBump: 1 },
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeCounty(value: string | null | undefined): string | null {
  const cleaned = cleanText(value)
  if (!cleaned) return null
  return cleaned
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function scorePpcLead(input: PpcLeadIntelligenceInput): number {
  const timeline = input.timeline ? TIMELINE_DETAILS[input.timeline] : null
  const condition = input.condition ? CONDITION_DETAILS[input.condition] : null
  const auction = input.auctionStatus ? AUCTION_DETAILS[input.auctionStatus] : null
  let score = timeline?.baseScore ?? 4

  if (
    input.situation === 'tax-delinquent' ||
    input.situation === 'redemption-window' ||
    input.situation === 'excess-proceeds'
  ) score += 2
  else if (
    input.situation === 'redemption-not-sure' ||
    input.situation === 'excess-not-sure' ||
    input.situation === 'condition' ||
    input.situation === 'tired-landlord' ||
    input.situation === 'inherited' ||
    input.situation === 'life-event'
  ) score += 1

  score += condition?.scoreBump ?? 0
  score += auction?.scoreBump ?? 0
  if (input.formStatus === 'submitted') score += 1
  if (input.formStatus === 'potential_no_submit') score -= 1

  return Math.max(1, Math.min(10, Math.round(score)))
}

export function buildPpcSellerSituationSummary(
  input: PpcLeadIntelligenceInput,
): string | null {
  const parts: string[] = []
  if (input.situation) parts.push(`reason: ${SITUATION_LABELS[input.situation]}`)
  if (input.condition) parts.push(`condition: ${CONDITION_DETAILS[input.condition].label}`)
  if (input.timeline) parts.push(`timing: ${TIMELINE_DETAILS[input.timeline].label}`)
  if (input.auctionStatus) parts.push(AUCTION_DETAILS[input.auctionStatus].label.toLowerCase())

  const county = normalizeCounty(input.county)
  const state = cleanText(input.state)?.toUpperCase()
  if (county || state) {
    parts.push(`county: ${[county, state].filter(Boolean).join(', ')}`)
  }

  return parts.length > 0 ? `PPC intake: ${parts.join('; ')}.` : null
}

export function derivePpcLeadIntelligence(
  input: PpcLeadIntelligenceInput,
): PpcLeadIntelligenceResult {
  return {
    sellerSituation: buildPpcSellerSituationSummary(input),
    motivationScore: scorePpcLead(input),
    changed: [],
  }
}

export function buildPpcLeadCacheUpdates(
  result: PpcLeadIntelligenceResult,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {}
  if (result.sellerSituation) updates.seller_situation = result.sellerSituation
  if (result.motivationScore) updates.motivation_score = result.motivationScore
  return updates
}
