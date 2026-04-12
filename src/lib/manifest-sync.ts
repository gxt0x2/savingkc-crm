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
export async function updateManifestAndCascade(
  leadId: string,
  updater: (manifest: ManifestV2) => void,
  source?: string,
): Promise<boolean> {
  const row = await getManifestForLead(leadId)
  if (!row) return false

  const { manifest } = row
  const previousManifest = JSON.parse(JSON.stringify(manifest)) as ManifestV2

  // Apply the caller's mutations
  updater(manifest)

  // Stamp metadata
  manifest.lastUpdated = new Date().toISOString()
  if (source) manifest.lastUpdatedBy = source

  // Save + cascade to leads table + hot engine event bus
  await saveManifest(row.rowId, manifest, leadId, previousManifest)
  return true
}
