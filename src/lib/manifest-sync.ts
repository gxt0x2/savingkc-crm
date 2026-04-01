/**
 * Manifest Sync Helper
 * Lightweight functions to sync critical data from endpoints into manifests.
 * Used by: twilio-sms-webhook, twilio-missed-call, conversations/send, call-log, ghost-protocol
 */

import { createClient } from '@supabase/supabase-js'
import type { ManifestV2 } from './manifest-builder'

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
async function getManifestForLead(leadId: string): Promise<{ rowId: string; manifest: ManifestV2 } | null> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('manifests')
    .select('id, manifest')
    .eq('lead_id', leadId)
    .limit(1)
    .single()

  if (!data?.manifest) return null
  return { rowId: data.id, manifest: data.manifest as ManifestV2 }
}

/** Save manifest back to DB */
async function saveManifest(rowId: string, manifest: ManifestV2) {
  const supabase = getSupabase()
  await supabase
    .from('manifests')
    .update({
      manifest,
      current_station: manifest.currentStation,
      priority: manifest.priority,
      tier: manifest.tier,
      qualification_score: manifest.qualificationScore,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId)
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

  await saveManifest(row.rowId, manifest)
}

/** Sync priority from leads table to manifest */
export async function syncPriority(leadId: string, priority: 'hot' | 'warm' | 'cold'): Promise<void> {
  const row = await getManifestForLead(leadId)
  if (!row) return

  row.manifest.priority = priority
  row.manifest.lastUpdated = new Date().toISOString()
  await saveManifest(row.rowId, row.manifest)
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
    await saveManifest(row.rowId, manifest)
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
    await saveManifest(row.rowId, manifest)
  }
}

/** Add a situation type tag */
export async function addSituationType(leadId: string, tag: string): Promise<void> {
  const row = await getManifestForLead(leadId)
  if (!row) return

  if (!row.manifest.situation.type.includes(tag)) {
    row.manifest.situation.type.push(tag)
    row.manifest.lastUpdated = new Date().toISOString()
    await saveManifest(row.rowId, row.manifest)
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

  await saveManifest(row.rowId, row.manifest)
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
  const row = await getManifestForLead(leadId)
  if (!row) return

  const { manifest } = row
  if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
  manifest.ariIntelligence.briefingStale = true
  manifest.lastUpdated = new Date().toISOString()

  // Add motivation signals for high-intent events
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

  await saveManifest(row.rowId, manifest)
}
