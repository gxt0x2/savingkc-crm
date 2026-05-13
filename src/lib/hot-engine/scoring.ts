/**
 * Hot Opportunities Scoring Engine.
 *
 * One job: answer which lead earns the most money if Casey touches it now,
 * and costs the most if she does not.
 *
 * Formula:
 *   composite = stage_value * urgency
 *
 * Parked leads always score 0. Parking is a state, not a stage.
 *
 * Note: the deal_size multiplier was removed because our ARV / repair /
 * offer numbers are not yet captured reliably enough to score on. Spread
 * is still computed and returned for display, but it does not affect the
 * composite.
 */

import type { ManifestV2 } from '../manifest-builder'
import {
  classifyBucket,
  normalizeDealStage,
  type DealStage,
  type OpportunityBucket,
} from '@/types/pipeline'

export interface ScoreFactors {
  engagement: number
  velocity: number
  dealQuality: number
  timePressure: number
}

export interface HotScoreResult {
  composite: number
  stageValue: number
  urgency: number
  dealSize: number
  station: DealStage
  parked: boolean
  reasons: {
    urgency: string
    dealSize: string
    parked?: string
  }
  spread: number | null
  bucket: OpportunityBucket

  // Legacy cache/UI fields retained while downstream cards and Ari signal
  // generation still read the old shape.
  factors: ScoreFactors
  multiplier: number
  tierLabel: 'favorite' | 'caution' | 'long_shot' | 'not_scored'
  tierCapped: boolean
  missingFields: string[]
  rawInputs: Record<string, any>
}

const STAGE_VALUE: Record<DealStage, number> = {
  under_contract: 100,
  offer_made: 50,
  appointment_set: 40,
  qualified: 25,
  contacted: 8,
  new: 2,
  closed_won: 0,
  closed_lost: 0,
  dead: 0,
}

function dateMs(value?: string | null): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

function hoursUntil(value?: string | null): number | null {
  const time = dateMs(value)
  if (time === null) return null
  return (time - Date.now()) / (1000 * 60 * 60)
}

function daysUntil(value?: string | null): number | null {
  const hours = hoursUntil(value)
  return hours === null ? null : hours / 24
}

function daysSince(value?: string | null): number | null {
  const time = dateMs(value)
  if (time === null) return null
  return (Date.now() - time) / (1000 * 60 * 60 * 24)
}

function appointmentAt(manifest: ManifestV2): string | undefined {
  const timeline = (manifest.situation as any)?.timeline || {}
  return (
    timeline.appointmentAt ||
    timeline.appointment_at ||
    manifest.pipeline?.appointment?.scheduledAt ||
    undefined
  )
}

function urgencyMultiplier(manifest: ManifestV2, station: DealStage): { value: number; reason: string } {
  const appointmentHours = hoursUntil(appointmentAt(manifest))
  if (appointmentHours !== null && appointmentHours > 0 && appointmentHours <= 24) {
    return { value: 2.0, reason: 'appt_24h' }
  }
  if (appointmentHours !== null && appointmentHours > 0 && appointmentHours <= 72) {
    return { value: 1.5, reason: 'appt_72h' }
  }

  if (station === 'under_contract') {
    const contingencyDeadline = (manifest.financials as any)?.contingencyDeadline
    const contingencyDays = daysUntil(contingencyDeadline)
    if (contingencyDays !== null && contingencyDays >= 0 && contingencyDays <= 7) {
      return { value: 2.5, reason: 'contingency_7d' }
    }

    const lastTouch = manifest.communications?.lastSellerContactDate || manifest.communications?.lastInboundDate
    const silentDays = daysSince(lastTouch)
    if (silentDays !== null && silentDays >= 5) {
      return { value: 1.5, reason: 'title_silent_5d' }
    }
  }

  const timeline = manifest.situation?.timeline
  if (timeline?.foreclosureWindowDays !== undefined && timeline.foreclosureWindowDays <= 30) {
    return { value: 2.0, reason: 'foreclosure_30d' }
  }

  const sellerDeadlineDays = daysUntil(timeline?.sellerDeadline)
  if (sellerDeadlineDays !== null && sellerDeadlineDays >= 0 && sellerDeadlineDays <= 7) {
    return { value: 2.0, reason: 'seller_deadline_7d' }
  }
  if (sellerDeadlineDays !== null && sellerDeadlineDays >= 0 && sellerDeadlineDays <= 30) {
    return { value: 1.3, reason: 'seller_deadline_30d' }
  }

  if ((manifest as any).flags?.requiresAction || (manifest as any).requires_action) {
    return { value: 1.5, reason: 'ari_action_flag' }
  }

  if (station === 'offer_made') {
    const lastTouch = manifest.communications?.lastSellerContactDate
    const silentDays = daysSince(lastTouch)
    if (silentDays !== null && silentDays >= 2) {
      return { value: 1.3, reason: 'offer_silent_48h' }
    }
  }

  return { value: 1.0, reason: 'baseline' }
}

// Spread is computed for display only — it never moves the composite while
// ARV / repair / offer capture is unreliable. value=1.0 keeps the legacy
// shape so cache rows + UI cards stay readable.
function dealSizeMultiplier(manifest: ManifestV2): { value: number; reason: string; spread: number | null } {
  const financials = manifest.financials
  if (!financials) return { value: 1.0, reason: 'display_only', spread: null }

  const repair = financials.repair_estimate || 0
  const spread = financials.arv && financials.offer_amount
    ? financials.arv - financials.offer_amount - repair
    : financials.spread ?? null

  return { value: 1.0, reason: 'display_only', spread }
}

function isCurrentlyParked(manifest: ManifestV2): boolean {
  const parked =
    (manifest as any).is_parked === true ||
    (manifest as any).parking?.is_parked === true

  if (!parked) return false

  const until = (manifest as any).parked_until || (manifest as any).parking?.parked_until
  const untilTime = dateMs(until)
  return !(untilTime !== null && untilTime <= Date.now())
}

function tierForComposite(composite: number): HotScoreResult['tierLabel'] {
  if (composite >= 75) return 'favorite'
  if (composite >= 40) return 'caution'
  if (composite >= 15) return 'long_shot'
  return 'not_scored'
}

export function scoreOpportunity(manifest: ManifestV2): HotScoreResult {
  const station = normalizeDealStage(manifest.currentStation) ?? 'new'
  const parked = isCurrentlyParked(manifest)
  const stageValue = STAGE_VALUE[station] ?? 0
  const urgency = urgencyMultiplier(manifest, station)
  const dealSize = dealSizeMultiplier(manifest)
  const composite = parked ? 0 : Math.round(stageValue * urgency.value * dealSize.value)
  const bucket = classifyBucket(station, parked)

  const factors: ScoreFactors = {
    engagement: 0,
    velocity: 0,
    dealQuality: stageValue,
    timePressure: Math.round((urgency.value - 1) * 50),
  }

  const rawInputs = {
    stage: station,
    originalStage: manifest.currentStation,
    stageValue,
    urgency: urgency.value,
    urgencyReason: urgency.reason,
    dealSize: dealSize.value,
    dealSizeReason: dealSize.reason,
    spread: dealSize.spread,
    parked,
    bucket,
    isFavorite: !!(manifest as any).is_favorite,
    priorityHot: (manifest as any).priority === 'hot',
    priorityWarm: (manifest as any).priority === 'warm',
    velocity: { currentStation: station },
    dealQuality: {
      arv: manifest.financials?.arv,
      spread: dealSize.spread,
    },
  }

  return {
    composite,
    stageValue,
    urgency: urgency.value,
    dealSize: dealSize.value,
    station,
    parked,
    reasons: {
      urgency: urgency.reason,
      dealSize: dealSize.reason,
      ...(parked ? { parked: 'lead_is_parked' } : {}),
    },
    spread: dealSize.spread,
    bucket,
    factors,
    multiplier: urgency.value * dealSize.value,
    tierLabel: tierForComposite(composite),
    tierCapped: false,
    missingFields: [],
    rawInputs,
  }
}

export const scoreOpportunityLegacyShim = scoreOpportunity
