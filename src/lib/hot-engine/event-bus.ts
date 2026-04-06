/**
 * Hot Engine Event Bus
 *
 * Classifies manifest changes into invalidating vs non-invalidating events.
 * Invalidating events trigger surgical rescore of the affected lead.
 */

import type { ManifestV2 } from '../manifest-builder'
import { surgicalRescore } from './cache'

export interface HotEngineEvent {
  type: string
  leadId: string
  source: string
  tier1: boolean
}

type ChangeField =
  | 'communication'
  | 'stage'
  | 'financials'
  | 'timeline'
  | 'disposition'
  | 'motivation'
  | 'priority'
  | 'ghost_protocol'

interface ManifestDiff {
  invalidating: boolean
  fields: ChangeField[]
  tier1: boolean
  eventType: string
}

/**
 * Diff two manifests and classify the change.
 * Returns null for non-invalidating or same-value changes.
 */
export function classifyManifestChange(
  oldManifest: ManifestV2 | null,
  newManifest: ManifestV2,
  source: string,
): ManifestDiff | null {
  if (!oldManifest) {
    return { invalidating: true, fields: ['communication'], tier1: false, eventType: 'manifest_created' }
  }

  const fields: ChangeField[] = []
  let tier1 = false

  // ─── Communication events ───
  const oldComms = oldManifest.communications
  const newComms = newManifest.communications

  // Seller contact (inbound)
  if (newComms?.lastInboundDate !== oldComms?.lastInboundDate) {
    fields.push('communication')
    tier1 = true // seller inbound is always tier 1
  }

  // Last outbound changed
  if (newComms?.lastOutboundDate !== oldComms?.lastOutboundDate) {
    // Outbound no-connect is non-invalidating; but new outbound with contact is
    if (newComms?.totalTouchpoints !== oldComms?.totalTouchpoints) {
      fields.push('communication')
    }
  }

  // Seller contact date changed
  if (newComms?.lastSellerContactDate !== oldComms?.lastSellerContactDate) {
    fields.push('communication')
  }

  // ─── Stage changes ───
  if (newManifest.currentStation !== oldManifest.currentStation) {
    fields.push('stage')
    tier1 = true // stage advance is tier 1
  }

  // ─── Financial updates ───
  const oldFin = oldManifest.financials
  const newFin = newManifest.financials
  if (newFin && oldFin) {
    if (
      newFin.arv !== oldFin.arv ||
      newFin.offer_amount !== oldFin.offer_amount ||
      newFin.repair_estimate !== oldFin.repair_estimate ||
      newFin.as_is_value !== oldFin.as_is_value ||
      newFin.spread !== oldFin.spread
    ) {
      fields.push('financials')
    }
  } else if (newFin && !oldFin) {
    fields.push('financials')
  }

  // ─── Timeline / time-sensitive triggers ───
  const oldTl = oldManifest.situation?.timeline
  const newTl = newManifest.situation?.timeline
  if (newTl) {
    if (
      newTl.sellerDeadline !== oldTl?.sellerDeadline ||
      newTl.foreclosureWindowDays !== oldTl?.foreclosureWindowDays ||
      newTl.competingOffersPresent !== oldTl?.competingOffersPresent ||
      newTl.lifeEventType !== oldTl?.lifeEventType ||
      newTl.lifeEventStage !== oldTl?.lifeEventStage
    ) {
      fields.push('timeline')
    }
  }

  // ─── Disposition tier change ───
  if (newManifest.dispositionTier !== oldManifest.dispositionTier) {
    fields.push('disposition')
    if (newManifest.dispositionTier === 1) {
      tier1 = true // tier 1 call analyzer output
    }
  }

  // ─── Motivation score change ───
  if (newManifest.situation?.motivation?.score !== oldManifest.situation?.motivation?.score) {
    fields.push('motivation')
  }

  // ─── Priority change ───
  if (newManifest.priority !== oldManifest.priority) {
    fields.push('priority')
  }

  // ─── Ghost protocol activation ───
  // Detect via flags
  const newGhost = newManifest.flags?.opportunityFlags?.includes('ghost_protocol_active')
  const oldGhost = oldManifest.flags?.opportunityFlags?.includes('ghost_protocol_active')
  if (newGhost && !oldGhost) {
    fields.push('ghost_protocol')
  }

  // If no scoring-relevant fields changed, it's non-invalidating
  if (fields.length === 0) return null

  const eventType = fields.includes('communication')
    ? 'communication_event'
    : fields.includes('stage')
    ? 'stage_change'
    : fields.includes('financials')
    ? 'financial_update'
    : fields.includes('timeline')
    ? 'timeline_update'
    : fields.includes('disposition')
    ? 'disposition_change'
    : 'manifest_update'

  return {
    invalidating: true,
    fields,
    tier1,
    eventType,
  }
}

/**
 * Process a hot engine event — calls surgicalRescore.
 */
export async function processHotEngineEvent(event: HotEngineEvent): Promise<void> {
  await surgicalRescore(event.leadId, event.type, event.tier1)
}
