/**
 * Hot Opportunities Scoring Engine — Pure Functions
 *
 * scoreOpportunity(manifest) → HotScoreResult
 * No DB access. Computes a composite score in [0, 100] from these layers:
 *
 *   1. Four data-driven factors (sum range 0-100):
 *        Engagement   (0-35) — recency + inbound posture of seller contact
 *        Velocity     (0-25) — days since the current pipeline stage was entered
 *        Deal Quality (0-25) — spread, with bonuses for verified ARV / repair bid
 *        Time Pressure (0-15) — deadlines, competing offers, foreclosure, life events
 *
 *   2. Derived-signal bonuses added to the factor sum:
 *        +8   station ∈ {appointment, appt_set}
 *        +5   station not in {intake, new}
 *        +5   motivation.score > 5  (from AI call-transcript analysis)
 *      These are state/evidence signals, not manual labels — they reflect that
 *      the lead has actually advanced (appointment set, past intake) or that
 *      a call analysis flagged motivation.
 *
 *      Phase B removed the previous user-label bonuses (+12 is_favorite,
 *      +12 priority === 'hot', +6 'warm'). Those are manual labels that
 *      should affect *visibility* (is the lead pinned / on the hot list?),
 *      not the numeric composite — adding them to the score conflated
 *      "discover hot leads from data" with "re-rank leads I already
 *      labeled hot." The flags still live in `rawInputs` so cache.ts can
 *      keep using them for the hot-list gate and favorites-first slotting.
 *
 *   3. Multiplier: currently fixed at 1.0. (See computeMultiplier comment.)
 *
 * Composite = min(100, round(factorSum + bonusSum) * multiplier)
 *
 * Tier labels: favorite (≥75 with data gate passed), caution (≥75 gate-failed
 * or ≥50), long_shot (≥25), not_scored (<25). `tierCapped` is informational —
 * it does NOT reduce the composite, only flags that a high score is based on
 * incomplete data. UI code that sorts should keep using `composite`.
 */

import type { ManifestV2 } from '../manifest-builder'

export interface ScoreFactors {
  engagement: number   // 0-35
  velocity: number     // 0-25
  dealQuality: number  // 0-25
  timePressure: number // 0-15
}

export interface HotScoreResult {
  factors: ScoreFactors
  multiplier: number
  composite: number
  tierLabel: 'favorite' | 'caution' | 'long_shot' | 'not_scored'
  tierCapped: boolean
  missingFields: string[]
  rawInputs: Record<string, any>
}

function daysSince(dateStr?: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

// ─── Engagement (0-35) ───────────────────────────────────────────────────────

function scoreEngagement(m: ManifestV2): { score: number; inputs: Record<string, any> } {
  const comms = m.communications
  const inputs: Record<string, any> = {}

  // Determine last seller contact date
  const lastSellerDate = comms?.lastSellerContactDate || comms?.lastInboundDate
  const daysSinceContact = daysSince(lastSellerDate)
  inputs.lastSellerContactDate = lastSellerDate
  inputs.daysSinceContact = daysSinceContact

  // Recency tiers
  let score: number
  if (daysSinceContact === null) {
    score = 2
    inputs.recencyTier = 'never'
  } else if (daysSinceContact <= 1) {
    score = 35
    inputs.recencyTier = '24h'
  } else if (daysSinceContact <= 2) {
    score = 30
    inputs.recencyTier = '48h'
  } else if (daysSinceContact <= 3) {
    score = 25
    inputs.recencyTier = '72h'
  } else if (daysSinceContact <= 7) {
    score = 18
    inputs.recencyTier = '7d'
  } else if (daysSinceContact <= 14) {
    score = 10
    inputs.recencyTier = '14d'
  } else {
    score = 5
    inputs.recencyTier = '14d+'
  }

  // +3 bonus for seller-initiated contact
  const hasInbound = (comms?.totalInboundContacts ?? 0) > 0
  if (hasInbound) {
    score += 3
    inputs.sellerInitiatedBonus = true
  }

  // -5 penalty for cadence gap
  if (comms?.cadenceGapDetected) {
    score -= 5
    inputs.cadenceGapPenalty = true
  }

  // When responsePending is false (ball NOT in seller's court), hold score — no decay
  if (comms?.responsePending === false) {
    inputs.responsePendingHold = true
  }

  return { score: Math.max(0, Math.min(35, score)), inputs }
}

// ─── Velocity (0-25) ─────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  'intake', 'new', 'contacted', 'qualifying', 'qualified',
  'appt_set', 'discovery', 'research', 'valuation',
  'offer', 'offer_made', 'negotiations', 'contract',
  'under_contract', 'inspection', 'closing_prep', 'closing', 'closed',
] as const

function scoreVelocity(m: ManifestV2): { score: number; inputs: Record<string, any> } {
  const inputs: Record<string, any> = {}
  const station = m.currentStation
  inputs.currentStation = station

  // Find the enteredAt for the current stage from pipeline
  const pipeline = m.pipeline as Record<string, any>
  let enteredAt: string | undefined

  // Map the lead's current station to the pipeline key whose `enteredAt`
  // timestamp represents "when this stage began." Several stations intentionally
  // collapse to the same pipeline key because they share a meaningful starting
  // point — e.g. `new` is a pre-contact state that shares `intake` timing, and
  // `appt_set` follows from `discovery`. If you add a new station, pick the
  // pipeline key that most closely matches when the lead meaningfully advanced.
  const stationToPipeline: Record<string, string> = {
    intake: 'intake',
    new: 'intake',                // pre-contact — shares intake timing
    contacted: 'qualifying',
    qualifying: 'qualifying',
    qualified: 'discovery',
    appt_set: 'discovery',        // appointment set — follows discovery
    appointment: 'discovery',
    discovery: 'discovery',
    research: 'research',
    valuation: 'valuation',
    offer: 'offer',
    offer_made: 'offer',
    negotiations: 'negotiations',
    contract: 'contract',
    under_contract: 'contract',
    inspection: 'inspection',
    closing_prep: 'closing_prep',
    closing: 'closing',
    closed: 'closed',
  }

  const pipelineKey = stationToPipeline[station]
  if (pipelineKey && pipeline && pipeline[pipelineKey]) {
    enteredAt = pipeline[pipelineKey].enteredAt || pipeline[pipelineKey].completedAt
  }

  const daysSinceAdvance = daysSince(enteredAt)
  inputs.enteredAt = enteredAt
  inputs.daysSinceAdvance = daysSinceAdvance

  let score: number
  if (daysSinceAdvance === null) {
    score = 8
    inputs.velocityTier = 'no_data'
  } else if (daysSinceAdvance <= 3) {
    score = 25
    inputs.velocityTier = '72h'
  } else if (daysSinceAdvance <= 7) {
    score = 20
    inputs.velocityTier = '7d'
  } else if (daysSinceAdvance <= 14) {
    score = 10
    inputs.velocityTier = '7-14d'
  } else if (daysSinceAdvance <= 21) {
    score = 6
    inputs.velocityTier = '14-21d'
  } else {
    score = 3
    inputs.velocityTier = '21d+'
  }

  // -5 penalty for overdue action (stale in stage >14d)
  if (daysSinceAdvance !== null && daysSinceAdvance > 14) {
    score -= 5
    inputs.overduePenalty = true
  }

  return { score: Math.max(0, Math.min(25, score)), inputs }
}

// ─── Deal Quality (0-25) ─────────────────────────────────────────────────────

function scoreDealQuality(m: ManifestV2): { score: number; inputs: Record<string, any> } {
  const f = m.financials
  const inputs: Record<string, any> = {}

  if (!f) {
    inputs.noFinancials = true
    return { score: 0, inputs }
  }

  // Compute spread
  const arv = f.arv
  const offer = f.offer_amount
  const repair = f.repair_estimate || 0
  const spread = arv && offer ? arv - offer - repair : f.spread
  inputs.arv = arv
  inputs.offer = offer
  inputs.repair = repair
  inputs.spread = spread
  inputs.arvSource = f.arv_source
  inputs.repairSource = f.repair_estimate_source

  // $25k floor: if spread < $25k, score is 0
  if (spread !== undefined && spread !== null && spread < 25000) {
    inputs.spreadBelowFloor = true
    return { score: 0, inputs }
  }

  const verified = f.arv_source === 'comps' || f.arv_source === 'agent_opinion'
  const hasRepairBid = f.repair_estimate_source === 'contractor_bid'
  inputs.verified = verified
  inputs.hasRepairBid = hasRepairBid

  let score: number
  if (!spread || spread === undefined) {
    score = 5
    inputs.spreadTier = 'unknown'
  } else if (spread >= 40000 && verified) {
    score = 25
    inputs.spreadTier = '40k+_verified'
  } else if (spread >= 40000) {
    score = 20
    inputs.spreadTier = '40k+_estimates'
  } else if (spread >= 30000 && verified) {
    score = 18
    inputs.spreadTier = '30-40k_verified'
  } else if (spread >= 30000) {
    score = 15
    inputs.spreadTier = '30-40k_estimates'
  } else if (spread >= 25000 && verified) {
    score = 12
    inputs.spreadTier = '25-30k_verified'
  } else {
    score = 8
    inputs.spreadTier = '25-30k_estimates'
  }

  // -3 for Zestimate-only ARV
  if (f.arv_source === 'zestimate') {
    score -= 3
    inputs.zestimatePenalty = true
  }

  // -3 for stale comps (arv_date > 90 days old)
  if (f.arv_date) {
    const arvAge = daysSince(f.arv_date)
    if (arvAge !== null && arvAge > 90) {
      score -= 3
      inputs.staleCompsPenalty = true
    }
  }

  // +2 for as-is > offer (dual exit potential)
  if (f.as_is_value && offer && f.as_is_value > offer) {
    score += 2
    inputs.dualExitBonus = true
  }

  return { score: Math.max(0, Math.min(25, score)), inputs }
}

// ─── Time Pressure (0-15) ────────────────────────────────────────────────────

function scoreTimePressure(m: ManifestV2): { score: number; inputs: Record<string, any> } {
  const timeline = m.situation?.timeline
  const inputs: Record<string, any> = {}

  if (!timeline) {
    inputs.noTimeline = true
    return { score: 1, inputs }
  }

  let score = 1

  // Hard deadline
  const deadlineDays = daysUntil(timeline.sellerDeadline)
  inputs.sellerDeadline = timeline.sellerDeadline
  inputs.deadlineDays = deadlineDays
  inputs.deadlineVerified = timeline.sellerDeadlineVerified

  if (deadlineDays !== null && deadlineDays <= 7) {
    score = Math.max(score, 15)
    inputs.pressureTier = '7d_deadline'
  } else if (deadlineDays !== null && deadlineDays <= 30) {
    score = Math.max(score, 11)
    inputs.pressureTier = '30d_deadline'
  }

  // Foreclosure window
  const foreclosureDays = timeline.foreclosureWindowDays
  inputs.foreclosureWindowDays = foreclosureDays
  if (foreclosureDays !== undefined && foreclosureDays !== null && foreclosureDays <= 60) {
    score = Math.max(score, 14)
    inputs.pressureTier = 'foreclosure_60d'
  }

  // Competing offers
  if (timeline.competingOffersPresent) {
    if (timeline.competingOfferSpecificity === 'specific') {
      score = Math.max(score, 13)
      inputs.pressureTier = 'competing_specific'
    } else {
      score = Math.max(score, 7)
      inputs.pressureTier = 'competing_vague'
    }
  }

  // Life event
  if (timeline.lifeEventType) {
    if (timeline.lifeEventStage === 'active_resolution') {
      score = Math.max(score, 9)
      inputs.pressureTier = 'life_event_active'
    } else {
      score = Math.max(score, 5)
      inputs.pressureTier = 'life_event_mentioned'
    }
  }

  // General urgency/hard deadline flags
  if (timeline.hardDeadline && score < 11) {
    score = Math.max(score, 11)
    inputs.pressureTier = 'hard_deadline_general'
  }

  if (timeline.urgency === 'critical' && score < 13) {
    score = Math.max(score, 13)
    inputs.pressureTier = 'urgency_critical'
  } else if (timeline.urgency === 'high' && score < 9) {
    score = Math.max(score, 9)
    inputs.pressureTier = 'urgency_high'
  }

  return { score: Math.min(15, score), inputs }
}

// ─── Multiplier ──────────────────────────────────────────────────────────────

// Composite multiplier is intentionally fixed at 1.0.
//
// Previously this returned 1.1–1.3× for verified short deadlines, specific
// competing offers, and 30-day deadlines — but those are the exact same
// signals that already inflate the Time Pressure factor (0–15). Applying both
// at once compounded the reward: a 7-day verified deadline added +15 from the
// factor AND multiplied the rest of the score by 1.3×, double-paying for one
// event.
//
// The wire-format field is preserved (HotScoreResult.multiplier, the cache
// column, audit trail rows) for downstream stability — removing it entirely
// would require a schema migration and touches every consumer. When the next
// recalibration runs (Phase C of the scoring rework), this function can be
// repurposed for a genuinely orthogonal multiplier if one is identified, but
// it must not re-reward any signal already scored in the factors above.
function computeMultiplier(_m: ManifestV2): { multiplier: number } {
  return { multiplier: 1.0 }
}

// ─── Favorite Data Gate ──────────────────────────────────────────────────────

function checkFavoriteGate(m: ManifestV2): { passed: boolean; missing: string[] } {
  const missing: string[] = []

  if (!m.financials?.arv) missing.push('ARV')
  if (!m.financials?.repair_estimate) missing.push('Repair Estimate')

  // Must have at least one call analyzer output (transcript with extractedData)
  const hasAnalyzedCall = m.communications?.transcripts?.some(
    t => t.extractedData && t.extractedData.motivationScore !== undefined
  )
  if (!hasAnalyzedCall) missing.push('Call Analysis')

  // Must be past initial contact
  const station = m.currentStation
  const pastInitial = !['intake', 'new'].includes(station)
  if (!pastInitial) missing.push('Past Initial Contact')

  return { passed: missing.length === 0, missing }
}

// ─── Main Scoring Function ───────────────────────────────────────────────────

export function scoreOpportunity(manifest: ManifestV2): HotScoreResult {
  const eng = scoreEngagement(manifest)
  const vel = scoreVelocity(manifest)
  const dq = scoreDealQuality(manifest)
  const tp = scoreTimePressure(manifest)
  const mult = computeMultiplier(manifest)

  const factors: ScoreFactors = {
    engagement: eng.score,
    velocity: vel.score,
    dealQuality: dq.score,
    timePressure: tp.score,
  }

  const rawSum = eng.score + vel.score + dq.score + tp.score

  // Derived-signal bonuses — evidence that the lead has actually advanced or
  // that analysis flagged motivation. Manual user labels (is_favorite, priority)
  // are intentionally NOT included here (see Phase B rationale in the top-of-
  // file comment). They're still surfaced in `rawInputs` for the cache.ts
  // filter layer to drive visibility without inflating the composite.
  let bonus = 0
  // Appointment set — concrete forward progress
  if (['appointment', 'appt_set'].includes(manifest.currentStation)) bonus += 8
  // Past initial contact — we've at least made contact
  if (!['intake', 'new'].includes(manifest.currentStation)) bonus += 5
  // Call analyzer returned motivation > 5 — the seller expressed interest
  if (manifest.situation?.motivation?.score && manifest.situation.motivation.score > 5) bonus += 5

  const composite = Math.min(100, Math.round((rawSum + bonus) * mult.multiplier))

  // Determine tier
  let tierLabel: HotScoreResult['tierLabel']
  let tierCapped = false
  const gate = checkFavoriteGate(manifest)

  if (composite >= 75) {
    if (gate.passed) {
      tierLabel = 'favorite'
    } else {
      tierLabel = 'caution'
      tierCapped = true
    }
  } else if (composite >= 50) {
    tierLabel = 'caution'
  } else if (composite >= 25) {
    tierLabel = 'long_shot'
  } else {
    tierLabel = 'not_scored'
  }

  const rawInputs = {
    engagement: eng.inputs,
    velocity: vel.inputs,
    dealQuality: dq.inputs,
    timePressure: tp.inputs,
    multiplier: mult,
    bonus,
    isFavorite: !!(manifest as any).is_favorite,
    priorityHot: (manifest as any).priority === 'hot',
    priorityWarm: (manifest as any).priority === 'warm',
    stationBonus: ['appointment', 'appt_set'].includes(manifest.currentStation) ? 8 : !['intake', 'new'].includes(manifest.currentStation) ? 5 : 0,
    motivationBonus: (manifest.situation?.motivation?.score && manifest.situation.motivation.score > 5) ? 5 : 0,
    // AI call-transcript opportunity score — surfaced so the hot-list gate
    // can override tier/engagement filters when the AI explicitly flagged
    // this lead as an opportunity (>= 75).
    opportunityScore: manifest.scoring?.opportunity_score ?? 0,
    opportunityClassification: manifest.scoring?.classification || null,
  }

  return {
    factors,
    multiplier: mult.multiplier,
    composite,
    tierLabel,
    tierCapped,
    missingFields: gate.missing,
    rawInputs,
  }
}
