import type { ManifestV2 } from '@/lib/manifest-builder'
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

const SITUATION_DETAILS: Record<PpcSituation, { primary: string; label: string; signal: string }> = {
  'tax-delinquent': {
    primary: 'Resolve property tax pressure',
    label: 'Tax delinquency or tax sale concern',
    signal: 'Tax pressure',
  },
  inherited: {
    primary: 'Simplify an inherited property',
    label: 'Inherited property',
    signal: 'Inherited property',
  },
  'tired-landlord': {
    primary: 'Exit a landlord burden',
    label: 'Tired landlord',
    signal: 'Tired landlord',
  },
  condition: {
    primary: 'Sell as-is instead of making repairs',
    label: 'Property condition is the issue',
    signal: 'Property condition concern',
  },
  'life-event': {
    primary: 'Handle a life change',
    label: 'Life event driving the sale',
    signal: 'Life event',
  },
  other: {
    primary: 'Explore selling options',
    label: 'Seller is exploring selling options',
    signal: 'Exploring selling options',
  },
}

const TIMELINE_DETAILS: Record<PpcTimeline, {
  label: string
  preferredClosing: string
  flexibility: NonNullable<NonNullable<ManifestV2['situation']['timeline']>['flexibility']>
  urgencyLevel: NonNullable<NonNullable<ManifestV2['situation']['motivation']>['urgencyLevel']>
  baseScore: number
}> = {
  asap: {
    label: 'ASAP',
    preferredClosing: 'As soon as possible',
    flexibility: 'not_flexible',
    urgencyLevel: 'critical',
    baseScore: 8,
  },
  '60-days': {
    label: 'Within 60 days',
    preferredClosing: 'Within 60 days',
    flexibility: 'somewhat_flexible',
    urgencyLevel: 'high',
    baseScore: 6,
  },
  flexible: {
    label: 'Flexible',
    preferredClosing: 'Flexible',
    flexibility: 'flexible',
    urgencyLevel: 'medium',
    baseScore: 4,
  },
  exploring: {
    label: 'Exploring options',
    preferredClosing: 'Exploring options',
    flexibility: 'very_flexible',
    urgencyLevel: 'low',
    baseScore: 3,
  },
}

const CONDITION_DETAILS: Record<PpcCondition, { label: string; notes: string; scoreBump: number }> = {
  good: {
    label: 'Good condition',
    notes: 'Seller said the property is in good condition on the paid form.',
    scoreBump: 0,
  },
  'needs-work': {
    label: 'Property needs work',
    notes: 'Seller said the property needs work on the paid form.',
    scoreBump: 1,
  },
  'major-repair': {
    label: 'Major repairs needed',
    notes: 'Seller said the property needs major repairs on the paid form.',
    scoreBump: 2,
  },
  vacant: {
    label: 'Property is vacant',
    notes: 'Seller said the property is vacant on the paid form.',
    scoreBump: 2,
  },
}

const AUCTION_DETAILS: Record<PpcAuctionStatus, { label: string; scoreBump: number }> = {
  yes: { label: 'Auction status: yes', scoreBump: 2 },
  no: { label: 'Auction status: no', scoreBump: 0 },
  'not-sure': { label: 'Auction status: not sure', scoreBump: 1 },
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isPpcSituation(value: unknown): value is PpcSituation {
  return typeof value === 'string' && value in SITUATION_TO_TAG
}

function isPpcTimeline(value: unknown): value is PpcTimeline {
  return typeof value === 'string' && value in TIMELINE_TO_URGENCY
}

function isPpcCondition(value: unknown): value is PpcCondition {
  return typeof value === 'string' && value in CONDITION_TO_OVERALL
}

function isPpcAuctionStatus(value: unknown): value is PpcAuctionStatus {
  return value === 'yes' || value === 'no' || value === 'not-sure'
}

function pushUnique(target: string[], value: string | null | undefined): boolean {
  const cleaned = cleanText(value)
  if (!cleaned || target.includes(cleaned)) return false
  target.push(cleaned)
  return true
}

function normalizeCounty(value: string | null | undefined): string | null {
  const cleaned = cleanText(value)
  if (!cleaned) return null
  return cleaned
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function scorePpcLead(input: PpcLeadIntelligenceInput): number | null {
  const timeline = input.timeline ? TIMELINE_DETAILS[input.timeline] : null
  const condition = input.condition ? CONDITION_DETAILS[input.condition] : null
  const auction = input.auctionStatus ? AUCTION_DETAILS[input.auctionStatus] : null
  let score = timeline?.baseScore ?? 4

  if (input.situation === 'tax-delinquent') score += 2
  else if (input.situation === 'condition' || input.situation === 'tired-landlord') score += 1
  else if (input.situation === 'inherited' || input.situation === 'life-event') score += 1

  score += condition?.scoreBump ?? 0
  score += auction?.scoreBump ?? 0
  if (input.formStatus === 'submitted') score += 1
  if (input.formStatus === 'potential_no_submit') score -= 1

  return Math.max(1, Math.min(10, Math.round(score)))
}

export function buildPpcSellerSituationSummary(input: PpcLeadIntelligenceInput): string | null {
  const parts: string[] = []
  if (input.situation) parts.push(`reason: ${SITUATION_DETAILS[input.situation].label}`)
  if (input.condition) parts.push(`condition: ${CONDITION_DETAILS[input.condition].label}`)
  if (input.timeline) parts.push(`timing: ${TIMELINE_DETAILS[input.timeline].label}`)
  if (input.auctionStatus) parts.push(AUCTION_DETAILS[input.auctionStatus].label.toLowerCase())

  const county = normalizeCounty(input.county)
  const state = cleanText(input.state)?.toUpperCase()
  if (county || state) {
    parts.push(`county: ${[county, state].filter(Boolean).join(', ')}`)
  }

  if (parts.length === 0) return null
  return `PPC intake: ${parts.join('; ')}.`
}

export function ppcLeadIntelligenceFromActivityMetadata(
  metadata: Record<string, unknown> | null | undefined,
  fallback: Partial<PpcLeadIntelligenceInput> = {},
): PpcLeadIntelligenceInput | null {
  if (!metadata) return null
  const source = cleanText(metadata.source)
  if (!source?.startsWith('ppc_form_')) return null

  const requestContext = metadata.request_context && typeof metadata.request_context === 'object'
    ? metadata.request_context as Record<string, unknown>
    : null

  return {
    ...fallback,
    source,
    formStatus: cleanText(metadata.form_status),
    situation: isPpcSituation(metadata.situation_raw) ? metadata.situation_raw : fallback.situation ?? null,
    timeline: isPpcTimeline(metadata.timeline_raw) ? metadata.timeline_raw : fallback.timeline ?? null,
    condition: isPpcCondition(metadata.condition_raw) ? metadata.condition_raw : fallback.condition ?? null,
    auctionStatus: isPpcAuctionStatus(metadata.auction_status) ? metadata.auction_status : fallback.auctionStatus ?? null,
    address: cleanText(metadata.address) ?? fallback.address ?? null,
    addressSource: cleanText(metadata.address_source) ?? fallback.addressSource ?? null,
    attribution: metadata.attribution && typeof metadata.attribution === 'object'
      ? metadata.attribution as Record<string, unknown>
      : fallback.attribution ?? null,
    capturedAt: fallback.capturedAt ?? null,
    city: fallback.city ?? null,
    state: fallback.state ?? null,
    zip: fallback.zip ?? null,
    county: fallback.county ?? null,
    fullName: fallback.fullName ?? null,
    ...(requestContext?.landing_page_path ? { landingPagePath: requestContext.landing_page_path } : {}),
  } as PpcLeadIntelligenceInput
}

export function applyPpcLeadIntelligenceToManifest(
  manifest: ManifestV2,
  input: PpcLeadIntelligenceInput,
): PpcLeadIntelligenceResult {
  const changed: string[] = []
  const now = cleanText(input.capturedAt) ?? new Date().toISOString()
  const sellerSituation = buildPpcSellerSituationSummary(input)
  const motivationScore = scorePpcLead(input)

  manifest.source = input.source?.startsWith('ppc_form_') ? 'ppc-landing' : manifest.source
  manifest.leadSource = 'ppc-landing'
  if (!manifest.situation) manifest.situation = { type: [] } as ManifestV2['situation']
  if (!Array.isArray(manifest.situation.type)) manifest.situation.type = []
  if (!manifest.situation.motivation) manifest.situation.motivation = {}
  if (!Array.isArray(manifest.situation.motivation.secondary)) manifest.situation.motivation.secondary = []
  if (!Array.isArray(manifest.situation.motivation.signals)) manifest.situation.motivation.signals = []
  if (!manifest.situation.timeline) manifest.situation.timeline = {}
  if (!manifest.property) manifest.property = {} as ManifestV2['property']
  if (!manifest.property.condition) manifest.property.condition = {}
  if (!manifest.flags) manifest.flags = {}
  if (!Array.isArray(manifest.flags.redFlags)) manifest.flags.redFlags = []
  if (!Array.isArray(manifest.flags.opportunityFlags)) manifest.flags.opportunityFlags = []
  if (!Array.isArray(manifest.agentNotes)) manifest.agentNotes = []
  if (!Array.isArray(manifest.auditTrail)) manifest.auditTrail = []

  if (input.situation) {
    const tag = SITUATION_TO_TAG[input.situation]
    if (pushUnique(manifest.situation.type, tag)) changed.push('situation_type')
    const details = SITUATION_DETAILS[input.situation]
    if (!manifest.situation.motivation.primary) {
      manifest.situation.motivation.primary = details.primary
      changed.push('motivation_primary')
    }
    if (pushUnique(manifest.situation.motivation.secondary, details.label)) changed.push('motivation_secondary')
    if (pushUnique(manifest.situation.motivation.signals, details.signal)) changed.push('motivation_signals')
  }

  if (input.timeline) {
    const details = TIMELINE_DETAILS[input.timeline]
    manifest.situation.timeline.urgency = TIMELINE_TO_URGENCY[input.timeline]
    manifest.situation.timeline.flexibility = details.flexibility
    if (!manifest.situation.timeline.preferredClosing) {
      manifest.situation.timeline.preferredClosing = details.preferredClosing
    }
    manifest.situation.motivation.urgencyLevel = details.urgencyLevel
    if (pushUnique(manifest.situation.motivation.signals, `Timeline: ${details.label}`)) {
      changed.push('timeline')
    }
  }

  if (input.condition) {
    const details = CONDITION_DETAILS[input.condition]
    manifest.property.condition.overall = CONDITION_TO_OVERALL[input.condition]
    if (!manifest.property.condition.notes || manifest.property.condition.notes.startsWith('Seller said')) {
      manifest.property.condition.notes = details.notes
    }
    if (input.condition === 'vacant') {
      manifest.property.vacant = true
      manifest.property.occupancy = 'vacant'
      pushUnique(manifest.situation.type, 'vacant')
    }
    if (pushUnique(manifest.situation.motivation.signals, details.label)) {
      changed.push('condition')
    }
  }

  if (input.auctionStatus) {
    const auctionFlag = `auction_status_${input.auctionStatus.replace('-', '_')}`
    manifest.flags.opportunityFlags = manifest.flags.opportunityFlags.filter(
      (flag) => !flag.startsWith('auction_status_'),
    )
    manifest.flags.opportunityFlags.push(auctionFlag)
    manifest.flags.redFlags = manifest.flags.redFlags.filter((flag) => flag !== 'home_sold_at_auction')
    if (input.auctionStatus === 'yes') {
      manifest.flags.redFlags.push('home_sold_at_auction')
      manifest.situation.timeline.hardDeadline = true
      manifest.situation.timeline.deadlineReason = 'Seller reported auction risk on the PPC form'
    }
    changed.push('auction_status')
  }

  if (input.address && !manifest.property.address) {
    manifest.property.address = input.address
    changed.push('property_address')
  }

  const county = normalizeCounty(input.county)
  if (county) {
    ;(manifest.property as Record<string, unknown>).county = county
    changed.push('county')
  }
  if (input.city) (manifest.property as Record<string, unknown>).city = input.city
  if (input.state) (manifest.property as Record<string, unknown>).state = input.state.toUpperCase()
  if (input.zip) (manifest.property as Record<string, unknown>).zip = input.zip

  if (sellerSituation && (!manifest.situation.summary || manifest.situation.summary.startsWith('PPC intake:'))) {
    manifest.situation.summary = sellerSituation
    changed.push('seller_situation')
  }

  if (motivationScore && (!manifest.situation.motivation.score || manifest.situation.motivation.score < motivationScore)) {
    manifest.situation.motivation.score = motivationScore
    changed.push('motivation_score')
  }

  if (sellerSituation) {
    const existingNote = manifest.agentNotes.find((note) => note.source === 'ppc_form' && note.author === 'system')
    if (existingNote) {
      existingNote.content = sellerSituation
      existingNote.timestamp = now
    } else {
      manifest.agentNotes.push({
        timestamp: now,
        author: 'system',
        source: 'ppc_form',
        content: sellerSituation,
      })
    }
    changed.push('agent_note')
  }

  if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
  manifest.ariIntelligence.briefingStale = true

  manifest.acquisition = {
    source: 'ppc-landing',
    channel: 'google-ads',
    attribution: {
      ...(input.attribution ?? {}),
      capturedAt: now,
    } as NonNullable<ManifestV2['acquisition']>['attribution'],
  }

  manifest.auditTrail.push({
    timestamp: now,
    agent: 'system:ppc_lead_intelligence',
    action: 'ppc_intelligence_promoted',
    details: {
      source: input.source,
      formStatus: input.formStatus,
      situation: input.situation,
      timeline: input.timeline,
      condition: input.condition,
      auctionStatus: input.auctionStatus,
      motivationScore,
      county,
    },
  })
  manifest.lastUpdated = now
  manifest.lastUpdatedBy = 'system:ppc_lead_intelligence'

  return {
    sellerSituation,
    motivationScore,
    changed: [...new Set(changed)],
  }
}

export function buildPpcLeadCacheUpdates(result: PpcLeadIntelligenceResult): Record<string, unknown> {
  const updates: Record<string, unknown> = {}
  if (result.sellerSituation) updates.seller_situation = result.sellerSituation
  return updates
}
