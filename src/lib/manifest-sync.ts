/**
 * Manifest Sync — Single Source of Truth
 *
 * ARCHITECTURE: The manifest is the ONLY source of truth for lead state.
 * All derived fields (leads.station, leads.priority, leads.motivation_score)
 * are cascaded FROM the manifest via saveManifest(). No other code should
 * write these fields to the leads table directly.
 *
 * Flow: event → update manifest → saveManifest() → cascade to leads table
 *
 * Used by: twilio-sms-webhook, twilio-missed-call, conversations/send,
 *          call-log, ghost-protocol, pipeline-auto-advance, mojo/reprocess
 */

import { createClient } from '@supabase/supabase-js'
import type { ManifestV2 } from './manifest-builder'
import { buildManifest } from './manifest-builder'
import { classifyManifestChange, processHotEngineEvent } from './hot-engine/event-bus'
import { autoEnrichLead } from './auto-enrich'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/** Deep merge that preserves sibling keys in nested objects */
export function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target }
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key]
    const targetVal = target[key]
    if (
      sourceVal !== null &&
      sourceVal !== undefined &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      targetVal !== undefined &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal, sourceVal as any)
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as any
    }
  }
  return result
}

/** Get manifest for a lead (returns null if none exists) */
async function getManifestForLead(leadId: string): Promise<{ rowId: string; leadId: string; manifest: ManifestV2 } | null> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('manifests')
    .select('id, lead_id, manifest')
    .eq('lead_id', leadId)
    .limit(1)
    .single()

  if (!data?.manifest) return null
  return { rowId: data.id, leadId: data.lead_id, manifest: data.manifest as ManifestV2 }
}

/**
 * Save manifest back to DB AND sync derived fields to leads table.
 * This is the SINGLE chokepoint — all manifest writes go through here,
 * and the leads table is always kept in sync. No other code should
 * write station/priority/motivation_score to leads directly.
 */
async function saveManifest(
  rowId: string,
  manifest: ManifestV2,
  leadId?: string,
  previousManifest?: ManifestV2 | null,
) {
  const supabase = getSupabase()

  // 1. Save manifest to manifests table
  await supabase
    .from('manifests')
    .update({
      manifest,
      current_station: manifest.currentStation,
      priority: manifest.priority,
      tier: manifest.tier,
      qualification_score: manifest.qualificationScore,
      next_appointment_at: manifest.pipeline?.appointment?.scheduledAt ?? null,
      appointment_status: manifest.pipeline?.appointment?.status ?? null,
      opportunity_score: manifest.scoring?.opportunity_score ?? null,
      classification: manifest.scoring?.classification ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId)

  // 2. Sync derived fields to leads table (manifest → leads, never the reverse)
  const resolvedLeadId = leadId || await getLeadIdForManifest(rowId)
  if (resolvedLeadId) {
    const leadUpdate: Record<string, any> = {}

    if (manifest.currentStation) leadUpdate.station = manifest.currentStation
    if (manifest.priority) leadUpdate.priority = manifest.priority

    const motivationScore = manifest.situation?.motivation?.score
    if (motivationScore && motivationScore >= 1) {
      leadUpdate.motivation_score = motivationScore
    }

    if (manifest.scoring?.opportunity_score !== undefined) {
      leadUpdate.opportunity_score = manifest.scoring.opportunity_score
    }
    if (manifest.scoring?.classification) {
      leadUpdate.classification = manifest.scoring.classification
    }

    if (Object.keys(leadUpdate).length > 0) {
      await supabase
        .from('leads')
        .update(leadUpdate)
        .eq('id', resolvedLeadId)
    }

    // 3. Hot Engine event bus — classify change and fire rescore if invalidating
    const diff = classifyManifestChange(previousManifest ?? null, manifest, manifest.lastUpdatedBy || 'unknown')
    if (diff?.invalidating) {
      processHotEngineEvent({
        type: diff.eventType,
        leadId: resolvedLeadId,
        source: manifest.lastUpdatedBy || 'unknown',
        tier1: diff.tier1,
      }).catch(err => console.error('[hot-engine] Event processing failed:', err))
    }
  }
}

/** Look up lead_id from manifest row ID */
async function getLeadIdForManifest(rowId: string): Promise<string | null> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('manifests')
    .select('lead_id')
    .eq('id', rowId)
    .single()
  return (data as any)?.lead_id || null
}

/** Mark briefing as stale so Ari regenerates on next view */
export async function markBriefingStale(leadId: string): Promise<void> {
  const row = await getManifestForLead(leadId)
  if (!row) return

  const { manifest } = row
  if (!manifest.ariIntelligence) {
    manifest.ariIntelligence = {}
  }
  manifest.ariIntelligence.briefingStale = true
  manifest.lastUpdated = new Date().toISOString()

  await saveManifest(row.rowId, manifest, leadId)
}

/** Sync priority to manifest (manifest is source of truth, leads table updates via cascade) */
export async function syncPriority(leadId: string, priority: 'hot' | 'warm' | 'cold'): Promise<void> {
  const row = await getManifestForLead(leadId)
  if (!row) return

  row.manifest.priority = priority
  row.manifest.lastUpdated = new Date().toISOString()
  await saveManifest(row.rowId, row.manifest, leadId)
}

/** Add a motivation signal to the manifest */
export async function addMotivationSignal(leadId: string, signal: string): Promise<void> {
  const row = await getManifestForLead(leadId)
  if (!row) return

  const { manifest } = row
  if (!manifest.situation.motivation) {
    manifest.situation.motivation = {}
  }
  if (!manifest.situation.motivation.signals) {
    manifest.situation.motivation.signals = []
  }
  if (!manifest.situation.motivation.signals.includes(signal)) {
    manifest.situation.motivation.signals.push(signal)
    manifest.lastUpdated = new Date().toISOString()
    if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
    manifest.ariIntelligence.briefingStale = true
    await saveManifest(row.rowId, manifest, leadId)
  }
}

/** Add a flag (red or opportunity) to the manifest */
export async function addFlag(
  leadId: string,
  type: 'redFlags' | 'opportunityFlags',
  flag: string,
): Promise<void> {
  const row = await getManifestForLead(leadId)
  if (!row) return

  const { manifest } = row
  if (!manifest.flags[type]) {
    manifest.flags[type] = []
  }
  if (!manifest.flags[type]!.includes(flag)) {
    manifest.flags[type]!.push(flag)
    manifest.lastUpdated = new Date().toISOString()
    await saveManifest(row.rowId, manifest, leadId)
  }
}

/** Add a situation type tag */
export async function addSituationType(leadId: string, tag: string): Promise<void> {
  const row = await getManifestForLead(leadId)
  if (!row) return

  if (!row.manifest.situation.type.includes(tag)) {
    row.manifest.situation.type.push(tag)
    row.manifest.lastUpdated = new Date().toISOString()
    await saveManifest(row.rowId, row.manifest, leadId)
  }
}

/** Set owner.deceased and add inherited situation type */
export async function flagDeceased(leadId: string): Promise<void> {
  const row = await getManifestForLead(leadId)
  if (!row || row.manifest.owner.deceased) return

  row.manifest.owner.deceased = true
  if (!row.manifest.situation.type.includes('inherited')) {
    row.manifest.situation.type.push('inherited')
  }
  if (!row.manifest.flags.opportunityFlags) {
    row.manifest.flags.opportunityFlags = []
  }
  if (!row.manifest.flags.opportunityFlags.includes('deceased_owner')) {
    row.manifest.flags.opportunityFlags.push('deceased_owner')
  }
  if (!row.manifest.ariIntelligence) row.manifest.ariIntelligence = {}
  row.manifest.ariIntelligence.briefingStale = true
  row.manifest.lastUpdated = new Date().toISOString()
  row.manifest.lastUpdatedBy = 'system:deceased_detection'

  await saveManifest(row.rowId, row.manifest, leadId)
}

/**
 * Detect deceased owner from text content (notes, activities, seller situation).
 * Returns true if deceased keywords are found.
 */
export function detectDeceasedSignals(text: string): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  const patterns = [
    'deceased', 'passed away', 'passed on', 'death in family',
    'inherited', 'inheritance', 'probate', 'estate sale',
    'executor', 'executrix', 'personal representative',
    'died', 'death certificate', 'obituary',
  ]
  return patterns.some(p => lower.includes(p))
}

/**
 * Batch sync: mark stale + add signals after any communication event.
 * Call this from SMS webhook, missed call handler, conversations/send, call-log.
 * Fire-and-forget (don't await in the calling route).
 */
export async function onCommunicationEvent(
  leadId: string,
  event: {
    type: 'inbound_sms' | 'outbound_sms' | 'inbound_call' | 'outbound_call' | 'missed_call' | 'voicemail' | 'email' | 'yes_reply'
    content?: string
  },
): Promise<void> {
  let row = await getManifestForLead(leadId)

  // Auto-create manifest if one doesn't exist yet
  if (!row) {
    await ensureManifestExists(leadId)
    row = await getManifestForLead(leadId)
    if (!row) return // Still no manifest (lead might not exist)
  }

  const { manifest } = row
  const previousManifest = JSON.parse(JSON.stringify(manifest)) as ManifestV2

  if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
  manifest.ariIntelligence.briefingStale = true
  manifest.lastUpdated = new Date().toISOString()

  // ─── Stamp communication metadata ───
  if (!manifest.communications) manifest.communications = { transcripts: [] }
  const comms = manifest.communications
  const now = new Date().toISOString()
  const isInbound = ['inbound_sms', 'inbound_call', 'yes_reply', 'missed_call'].includes(event.type)
  const isOutbound = ['outbound_sms', 'outbound_call'].includes(event.type)

  // Track touchpoints
  comms.totalTouchpoints = (comms.totalTouchpoints ?? 0) + 1

  if (isInbound) {
    comms.lastInboundDate = now
    comms.lastSellerContactDate = now
    comms.totalInboundContacts = (comms.totalInboundContacts ?? 0) + 1
    comms.lastConversationCloser = 'seller'
    comms.responsePending = false
    comms.outreachAttemptsSinceLastResponse = 0
    comms.daysSinceLastSellerResponse = 0
  }

  if (isOutbound) {
    comms.lastOutboundDate = now
    comms.lastConversationCloser = 'agent'
    comms.responsePending = true
    comms.outreachAttemptsSinceLastResponse = (comms.outreachAttemptsSinceLastResponse ?? 0) + 1
  }

  // Update channel-specific last dates
  if (event.type === 'inbound_call' || event.type === 'outbound_call' || event.type === 'missed_call') {
    manifest.lastCallDate = now
  } else if (event.type === 'inbound_sms' || event.type === 'outbound_sms' || event.type === 'yes_reply') {
    manifest.lastTextDate = now
  } else if (event.type === 'email') {
    manifest.lastEmailDate = now
  }

  // Detect cadence gap (>7 days between outbound with no response)
  if (comms.lastOutboundDate && comms.lastInboundDate) {
    const outDate = new Date(comms.lastOutboundDate).getTime()
    const inDate = new Date(comms.lastInboundDate).getTime()
    const daysBetween = Math.floor((outDate - inDate) / (1000 * 60 * 60 * 24))
    comms.cadenceGapDetected = daysBetween > 7
  }

  // ─── Add motivation signals for high-intent events ───
  if (!manifest.situation.motivation) manifest.situation.motivation = {}
  if (!manifest.situation.motivation.signals) manifest.situation.motivation.signals = []

  const signals = manifest.situation.motivation.signals
  switch (event.type) {
    case 'yes_reply':
      if (!signals.includes('replied_yes_to_text')) signals.push('replied_yes_to_text')
      if (!manifest.flags.opportunityFlags) manifest.flags.opportunityFlags = []
      if (!manifest.flags.opportunityFlags.includes('seller_initiated_contact')) {
        manifest.flags.opportunityFlags.push('seller_initiated_contact')
      }
      manifest.priority = 'hot'
      break
    case 'inbound_sms':
      if (!signals.includes('seller_texted_in')) signals.push('seller_texted_in')
      break
    case 'inbound_call':
    case 'missed_call':
      if (!signals.includes('seller_called_in')) signals.push('seller_called_in')
      break
    case 'voicemail':
      if (!signals.includes('left_voicemail')) signals.push('left_voicemail')
      break
  }

  // Check for deceased signals in message content
  if (event.content && detectDeceasedSignals(event.content)) {
    if (!manifest.owner.deceased) {
      manifest.owner.deceased = true
      if (!manifest.situation.type.includes('inherited')) {
        manifest.situation.type.push('inherited')
      }
      if (!manifest.flags.opportunityFlags) manifest.flags.opportunityFlags = []
      if (!manifest.flags.opportunityFlags.includes('deceased_owner')) {
        manifest.flags.opportunityFlags.push('deceased_owner')
      }
    }
  }

  await saveManifest(row.rowId, manifest, leadId, previousManifest)
}

/**
 * Ensure a manifest exists for a lead. Creates one if missing.
 * Call this when new leads are created from inbound SMS, missed calls, YES replies,
 * or any other source that doesn't go through /api/book or /api/manifests POST.
 */
export async function ensureManifestExists(leadId: string): Promise<string | null> {
  const supabase = getSupabase()

  // Check if manifest already exists (use maybeSingle to avoid error on 0 rows)
  const { data: existing } = await supabase
    .from('manifests')
    .select('id')
    .eq('lead_id', leadId)
    .limit(1)

  if (existing && existing.length > 0) {
    // Manifest exists - trigger auto-enrich in case it hasn't run yet
    console.log('[ensureManifestExists] Manifest exists, triggering autoEnrichLead for lead', leadId)
    autoEnrichLead(leadId).catch(err =>
      console.error('[auto-enrich] Background enrichment failed for lead', leadId, err)
    )
    return existing[0].id
  }

  // Fetch the lead to build a manifest
  const { data: lead } = await supabase
    .from('leads')
    .select('id, full_name, phone, email, property_address, city, state, zip, station, priority, source')
    .eq('id', leadId)
    .single()

  if (!lead) return null

  const nameParts = (lead.full_name || 'Unknown').split(' ')
  const manifest = buildManifest({
    firstName: nameParts[0] || 'Unknown',
    lastName: nameParts.slice(1).join(' ') || undefined,
    phone: lead.phone || undefined,
    email: lead.email || undefined,
    propertyAddress: lead.property_address || undefined,
    leadId: lead.id,
    station: lead.station || 'intake',
    priority: lead.priority === 'hot' ? 'hot' : lead.priority === 'high' ? 'warm' : 'cold',
    source: lead.source || 'inbound',
  })

  const { data: inserted, error } = await supabase
    .from('manifests')
    .insert({
      lead_id: leadId,
      manifest,
      current_station: manifest.currentStation,
      priority: manifest.priority,
    })
    .select('id')
    .single()

  if (error) {
    // If duplicate key error (code 23505), another process created it - fetch and return
    if (error.code === '23505' || error.message?.includes('duplicate') || error.message?.includes('unique')) {
      console.log('[ensureManifestExists] Manifest already exists for lead', leadId, '- returning existing')
      const { data: existing } = await supabase
        .from('manifests')
        .select('id')
        .eq('lead_id', leadId)
        .limit(1)
      return existing && existing.length > 0 ? existing[0].id : null
    }
    console.error('Failed to auto-create manifest for lead', leadId, error)
    return null
  }

  // Fire-and-forget: auto-enrich from prospect lookup + county assessor
  console.log('[ensureManifestExists] Triggering autoEnrichLead for lead', leadId)
  autoEnrichLead(leadId).catch(err =>
    console.error('[auto-enrich] Background enrichment failed for lead', leadId, err)
  )

  return inserted?.id || null
}

/**
 * Public API: Update manifest with partial data and cascade all derived fields.
 * This is the RECOMMENDED way for any endpoint to modify a manifest.
 *
 * Usage:
 *   await updateManifestAndCascade(leadId, (manifest) => {
 *     manifest.situation.motivation.score = 8
 *     manifest.currentStation = 'appointment'
 *     manifest.priority = 'hot'
 *   })
 *
 * The callback mutates the manifest in place. After it runs, saveManifest()
 * persists the change AND syncs derived fields to the leads table.
 */
/**
 * Legacy mutator-callback API. Kept for source-level compatibility with ~37
 * existing callsites. Under the hood, delegates to updateManifestV2_1 — so
 * every call now goes through the RPC, writes a manifest_history row, and
 * enjoys shallow-subtree replacement at the DB layer. Self-nesting can't
 * form even if the mutator does a deep merge, because the RPC only sees
 * discrete subtrees.
 *
 * New code should prefer updateManifestV2_1 directly. This shim exists so
 * the refactor doesn't require a 37-file churn to ship the infrastructure
 * upgrade.
 */
export async function updateManifestAndCascade(
  leadId: string,
  updater: (manifest: ManifestV2) => void,
  source?: string,
): Promise<boolean> {
  const result = await updateManifestV2_1({
    leadId,
    compute: (current) => {
      // Clone so the mutator can't accidentally alter our previousManifest
      // reference (used for the hot-engine diff inside updateManifestV2_1).
      const clone = JSON.parse(JSON.stringify(current)) as ManifestV2
      updater(clone)
      // Preserve the legacy metadata stamps so callers that assert on
      // lastUpdated / lastUpdatedBy continue to see them.
      ;(clone as any).lastUpdated = new Date().toISOString()
      if (source) (clone as any).lastUpdatedBy = source
      // Return every top-level key as a subtree. The RPC shallow-replaces
      // each one — no self-nesting, even if the mutator did a deep merge.
      const subtrees: Record<string, unknown> = {}
      for (const key of Object.keys(clone)) {
        subtrees[key] = (clone as any)[key]
      }
      return subtrees
    },
    actor: (source as ManifestActor) || 'system',
    reason: source || 'legacy:updateManifestAndCascade',
  }).catch((err) => {
    console.error('[manifest-sync] legacy updateManifestAndCascade shim failed:', err)
    return null
  })
  return !!result
}

// ─── V2.1 API — spec-shaped subtree-payload write path ────────────────────
// See docs/manifest-v2-1-spec/05_WRITE_PATH_AUDIT.md Step 4.5.
//
// This is the sanctioned callsite-facing API for the V2.1 refactor. Callers
// pass discrete subtrees that will shallow-replace their counterparts in the
// stored manifest — the doctrine that kills the self-nesting bug class. The
// heavy lifting (shallow replace, history row, denormalized column sync) is
// done by the update_manifest_and_cascade RPC inside Postgres, atomically.
//
// The legacy mutator-style updateManifestAndCascade above remains for now.
// Callers migrate to this new API over Phase 5 and Phase 11 cleanup.

export type ManifestActor = 'ernest' | 'casey' | 'ari' | 'system' | 'migration'

export interface UpdateManifestV2_1Params {
  /** Either manifestId or leadId must be provided. manifestId is preferred. */
  manifestId?: string
  leadId?: string
  /**
   * Top-level subtrees to replace. Siblings inside a subtree are wholly
   * replaced — if you want to preserve them, include them in the payload
   * (or use `compute` to derive the full subtree from the current manifest).
   */
  subtrees?: Record<string, unknown>
  /**
   * Alternative to `subtrees`: a pure function that receives the current
   * stored manifest and returns the subtrees to write. Use this when you
   * need to append to arrays or preserve sibling keys — the wrapper has
   * already fetched `current` internally, so no double read.
   */
  compute?: (current: ManifestV2) => Record<string, unknown>
  actor: ManifestActor | string
  reason: string
}

export class ManifestWriteError extends Error {
  constructor(msg: string, public readonly cause?: unknown) {
    super(msg)
    this.name = 'ManifestWriteError'
  }
}

/**
 * V2.1 write path. Routes through the update_manifest_and_cascade Postgres
 * RPC for shallow per-subtree replacement + history row + denormalized
 * column sync, then cascades to the leads table and fires the hot-engine
 * event bus on the TS side (those live outside the RPC for now).
 *
 * Returns the updated manifest, or null if the target manifest doesn't exist.
 * Throws ManifestWriteError for validation / RPC / auth failures.
 */
export async function updateManifestV2_1(
  params: UpdateManifestV2_1Params,
): Promise<ManifestV2 | null> {
  if (!params.manifestId && !params.leadId) {
    throw new ManifestWriteError('updateManifestV2_1: must provide manifestId or leadId')
  }
  if (!params.subtrees && !params.compute) {
    throw new ManifestWriteError('updateManifestV2_1: must provide subtrees or compute')
  }
  if (params.subtrees && params.compute) {
    throw new ManifestWriteError('updateManifestV2_1: provide subtrees OR compute, not both')
  }

  const supabase = getSupabase()

  // Resolve manifestId + capture pre-write state (for hot-engine diff).
  let manifestId = params.manifestId
  let leadId: string | null = params.leadId ?? null
  let previousManifest: ManifestV2 | null = null

  if (manifestId) {
    const { data } = await supabase
      .from('manifests')
      .select('lead_id, manifest')
      .eq('id', manifestId)
      .limit(1)
      .single()
    if (!data) return null
    leadId = (data as any).lead_id
    previousManifest = (data as any).manifest as ManifestV2
  } else {
    const { data } = await supabase
      .from('manifests')
      .select('id, manifest')
      .eq('lead_id', leadId!)
      .limit(1)
      .single()
    if (!data) return null
    manifestId = (data as any).id
    previousManifest = (data as any).manifest as ManifestV2
  }

  // Resolve subtrees (either static or computed from the current manifest).
  const resolvedSubtrees: Record<string, unknown> = params.compute
    ? params.compute(previousManifest!)
    : { ...params.subtrees! }

  // Strip derived fields client-side (RPC does this too, belt-and-suspenders).
  const cleaned: Record<string, unknown> = { ...resolvedSubtrees }
  for (const derivedKey of ['hot_eligibility', 'completeness']) {
    if (derivedKey in cleaned) {
      console.warn(
        `[updateManifestV2_1] Stripping derived key "${derivedKey}" from caller payload. ` +
        `These fields are recomputed on every write; callers cannot set them directly.`,
      )
      delete cleaned[derivedKey]
    }
  }

  // Call the atomic RPC: shallow replace + history row + denorm sync, all in
  // one transaction inside Postgres.
  const { data: next, error } = await supabase.rpc('update_manifest_and_cascade', {
    p_manifest_id: manifestId,
    p_subtrees: cleaned,
    p_actor: params.actor,
    p_reason: params.reason,
  })
  if (error) {
    throw new ManifestWriteError(
      `RPC update_manifest_and_cascade failed: ${error.message}`,
      error,
    )
  }

  const manifest = next as ManifestV2

  // TS-side cascade to the leads table (the RPC only syncs columns on
  // manifests). Remove once the RPC is extended to cascade, or once the
  // denormalized lead columns are retired.
  if (leadId) {
    const leadUpdate: Record<string, unknown> = {}
    if (manifest.currentStation) leadUpdate.station = manifest.currentStation
    if (manifest.priority) leadUpdate.priority = manifest.priority
    const motivationScore = manifest.situation?.motivation?.score
    if (motivationScore && motivationScore >= 1) {
      leadUpdate.motivation_score = motivationScore
    }
    if (manifest.scoring?.opportunity_score !== undefined) {
      leadUpdate.opportunity_score = manifest.scoring.opportunity_score
    }
    if (manifest.scoring?.classification) {
      leadUpdate.classification = manifest.scoring.classification
    }
    if (Object.keys(leadUpdate).length > 0) {
      await supabase.from('leads').update(leadUpdate).eq('id', leadId)
    }
  }

  // Hot-engine event bus — fire-and-forget, same as saveManifest.
  if (leadId && previousManifest) {
    const diff = classifyManifestChange(previousManifest, manifest, params.actor)
    if (diff?.invalidating) {
      processHotEngineEvent({
        type: diff.eventType,
        leadId,
        source: params.actor,
        tier1: diff.tier1,
      }).catch((err) =>
        console.error('[hot-engine] Event processing failed:', err),
      )
    }
  }

  return manifest
}
