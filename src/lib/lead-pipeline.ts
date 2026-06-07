/**
 * Lead Pipeline — idempotent reprocess of existing leads.
 *
 * Runs the same intelligence as the Mojo live path (/api/cron/process-mojo-queue),
 * but entered per-lead instead of per-call. Shares the low-level helpers
 * (enrichManifestProperty, scoreManifest, detectCounty, transcribeAudio,
 * analyzeCallTranscript) so both paths produce identical manifest state.
 *
 * Use cases:
 *   - Catch pre-pipeline leads up to current intelligence.
 *   - Repair leads where the live path completed but dropped data
 *     (e.g. lead_activities empty, score split-brain, mojo_record_id null).
 *
 * Idempotent: safe to call multiple times. Backfills only missing data;
 * dedups transcripts by mojo record_id, activities by metadata.mojo_record_id.
 */

import { supabase } from '@/lib/supabase-lazy'
import type {
  ManifestV2,
  ManifestScoring,
  TranscriptEntry,
  ManifestOwner,
  ManifestProperty,
  ManifestSituation,
} from '@/lib/manifest-builder'
import { ensureManifestExists } from '@/lib/manifest-sync'
import { enrichManifestProperty, scoreManifest } from '@/lib/manifest-enrichment'
import { detectCounty, parseAddressForCounty } from '@/lib/county-enrichment'
import { downloadRecording } from '@/lib/mojo-recording-downloader'
import { transcribeAudio } from '@/lib/mojo-transcriber'
import { analyzeCallTranscript, type CallAnalysisResult } from '@/lib/mojo-call-analyzer'
import {
  applyPpcLeadIntelligenceToManifest,
  ppcLeadIntelligenceFromActivityMetadata,
  type PpcLeadIntelligenceInput,
} from '@/lib/ppc/lead-intelligence'

export interface ReprocessOptions {
  suppressNotifications?: boolean
  refreshTranscripts?: boolean
  forceReEnrich?: boolean
}

export interface ReprocessResult {
  leadId: string
  manifestId: string | null
  opportunityScore: number | null
  qualificationScore: number | null
  changed: string[]
  skipped: string[]
  errors: string[]
}

interface MojoQueuePayload {
  record_id: string
  contact_name: string
  phone_number: string
  property_address: string
  city: string
  state: string
  zip: string
  call_date: string
  call_duration: number
  disposition: string
  agent_name: string
  notes?: string
  recording_url?: string
  follow_up_date?: string
  email?: string
}

interface QueueRow {
  id: string
  record_id: string
  payload: MojoQueuePayload
  status: string
  opportunity_score: number | null
  completed_at: string | null
  created_at: string
}

interface RecordingActivityRow {
  id: string
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

type LeadForPpcIntelligence = {
  property_address?: string | null
  full_name?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  county?: string | null
}

type PpcActivityMetadataRow = {
  metadata: Record<string, unknown> | null
  created_at: string | null
}

/**
 * Reprocess a single lead through the full intelligence pipeline.
 * Returns a summary of what changed.
 */
export async function reprocessLead(
  leadId: string,
  options: ReprocessOptions = {},
): Promise<ReprocessResult> {
  const { refreshTranscripts = true, forceReEnrich = false } = options
  const changed: string[] = []
  const skipped: string[] = []
  const errors: string[] = []

  // 1. Ensure manifest exists (creates from lead row if missing)
  const manifestId = await ensureManifestExists(leadId)
  if (!manifestId) {
    throw new Error(`No manifest and could not create for lead ${leadId}`)
  }

  const { data: manifestRow, error: mErr } = await supabase
    .from('manifests')
    .select('id, lead_id, manifest')
    .eq('id', manifestId)
    .single()
  if (mErr || !manifestRow) {
    throw new Error(`Failed to load manifest ${manifestId}: ${mErr?.message}`)
  }
  let manifest = manifestRow.manifest as ManifestV2
  manifest = ensureManifestArrays(manifest)

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()
  if (!lead) throw new Error(`Lead not found: ${leadId}`)

  // 2. Load all Mojo queue history for this lead
  const { data: queueRowsRaw } = await supabase
    .from('mojo_call_queue')
    .select('id, record_id, payload, status, opportunity_score, completed_at, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
  const queueRows = (queueRowsRaw || []) as QueueRow[]

  // 3. Ensure every queue row has a transcript entry in the manifest
  const addedTranscripts = ensureTranscriptsFromQueue(manifest, queueRows)
  if (addedTranscripts > 0) changed.push(`transcripts_added=${addedTranscripts}`)

  // 3b. Ensure Twilio recording activities also become transcript entries.
  // PPC form callbacks and inbound calls are written to lead_activities, not
  // mojo_call_queue, so the old reprocess path skipped them entirely.
  const recordingRows = await loadTwilioRecordingActivities(leadId)
  const addedRecordingTranscripts = ensureTranscriptsFromRecordingActivities(manifest, recordingRows)
  if (addedRecordingTranscripts > 0) changed.push(`twilio_transcripts_added=${addedRecordingTranscripts}`)

  // 4. Merge queue payload notes into manifest.agentNotes (dedup by callRecordId)
  const addedNotes = mergeAgentNotesFromQueue(manifest, queueRows)
  if (addedNotes > 0) changed.push(`agent_notes_added=${addedNotes}`)

  // 5. Re-transcribe & re-analyze any transcripts with recordingUrl missing data
  if (refreshTranscripts) {
    const tr = await refreshPendingTranscripts(manifest, errors)
    if (tr.transcribed > 0) changed.push(`transcribed=${tr.transcribed}`)
    if (tr.analyzed > 0) changed.push(`analyzed=${tr.analyzed}`)
    if (tr.skipped > 0) skipped.push(`transcripts=${tr.skipped}`)
  }

  // 5b. Heal split-address bug: some legacy imports put the house number in
  // leads.property_address and jammed "STREET CITY" into leads.city. When we
  // detect this pattern, look up the canonical address in prospect_phones by
  // phone and rewrite the lead + manifest property fields.
  const healed = await healSplitAddress(leadId, lead, manifest, errors)
  if (healed.length > 0) changed.push(`address_healed=${healed.join(',')}`)

  // 5c. Parse city/state/zip from property_address when the lead row
  // is missing them. Many legacy imports stashed everything in one column:
  // "729 Laurel Ave Liberty, MO 64068-1362". This lets the county scraper
  // route correctly without needing prospects.
  const addrParsed = await parseAddressFromPropertyString(leadId, lead)
  if (addrParsed.length > 0) changed.push(`addr_parsed=${addrParsed.join(',')}`)

  // 5d. Hydrate from prospects: even without the split pattern, the prospects
  // table holds county-authoritative data (parcel_id, market value, delinquency)
  // the county scrapers often fail to return. Match by phone, fill gaps.
  const hydrated = await hydrateFromProspect(leadId, lead, manifest, errors)
  if (hydrated.length > 0) changed.push(`prospect_hydrated=${hydrated.join(',')}`)

  // 5e. Promote paid-form answers into the canonical manifest fields used by
  // lead-page cards. PPC tracking rows were already healthy; this repairs the
  // intelligence lane so pain points, goals, ARI, and discovery questions see it.
  const ppcInput = await loadLatestPpcFormIntelligence(leadId, lead)
  if (ppcInput) {
    const promoted = applyPpcLeadIntelligenceToManifest(manifest, ppcInput)
    if (promoted.changed.length > 0) {
      changed.push(`ppc_intelligence=${promoted.changed.join(',')}`)
    }
  }

  // 5f. Call transcript intelligence is richer than the PPC intake snapshot.
  // Re-apply it after PPC promotion so backfilled leads do not stay stuck on
  // shallow "PPC intake" copy once a real call has been transcribed/analyzed.
  const transcriptPromoted = promoteLatestAnalyzedTranscriptToManifest(manifest)
  if (transcriptPromoted.length > 0) changed.push(`transcript_intelligence=${transcriptPromoted.join(',')}`)

  // 6. County enrichment if address present and dwelling data missing (or forced)
  const needsEnrich = forceReEnrich || healed.length > 0 || !manifest.property?.dwelling?.bedrooms
  const hasAddress = !!(
    (manifest.property?.address || lead.property_address) &&
    lead.state
  )
  if (needsEnrich && hasAddress) {
    const addr = manifest.property?.address || lead.property_address
    const city = lead.city || ''
    const state = lead.state || ''
    const zip = lead.zip || ''

    // Prefer lead.county (set by the healer from prospect data — authoritative
    // because detectCounty's city list is incomplete: Clay Co. includes
    // parts of Kansas City MO but detectCounty routes all "kansas city" → Jackson).
    // Reject bogus values (state codes, empty, unknown counties).
    const VALID_COUNTIES = new Set(['jackson', 'clay', 'johnson', 'platte', 'wyandotte'])
    let countyName: string | null = null
    const raw = String(lead.county || '').toLowerCase().trim()
    if (raw && VALID_COUNTIES.has(raw)) {
      countyName = raw.charAt(0).toUpperCase() + raw.slice(1)
    } else {
      const detected = detectCounty(city, state, zip)
      if (detected && VALID_COUNTIES.has(detected.county.toLowerCase())) {
        countyName = detected.county
      }
    }

    if (countyName) {
      try {
        manifest = await enrichManifestProperty(
          manifest,
          addr,
          city,
          state,
          zip,
          countyName,
          lead.parcel_id || undefined,
        )
        changed.push(`enriched_via=${countyName.toLowerCase()}`)
      } catch (err: any) {
        errors.push(`enrich_failed: ${err?.message || String(err)}`)
      }
    } else {
      skipped.push('county_not_detected')
    }
  }

  // 7. Rescore — prefer AI (from latest transcript), fall back to manifest scoring
  const scoringResult = computeScoring(manifest, queueRows, lead)
  if (scoringResult) {
    manifest.scoring = scoringResult
    changed.push(`scored=${scoringResult.opportunity_score}/${scoringResult.classification}/${scoringResult.scored_by}`)
  }

  // 8. Qualification score from manifest state
  const { score: qualScore, tier } = scoreManifest(manifest)
  manifest.qualificationScore = qualScore
  manifest.tier = tier as ManifestV2['tier']

  // 9. Priority from highest available score
  const primaryScore = manifest.scoring?.opportunity_score ?? qualScore
  manifest.priority = primaryScore >= 75 ? 'hot' : primaryScore >= 40 ? 'warm' : 'cold'

  // 10. Audit trail entry
  manifest.auditTrail.push({
    timestamp: new Date().toISOString(),
    agent: 'system:reprocess',
    action: 'lead_reprocessed',
    details: {
      changed,
      skipped,
      errors,
      opportunityScore: manifest.scoring?.opportunity_score,
      qualificationScore: manifest.qualificationScore,
    },
  })
  manifest.lastUpdated = new Date().toISOString()
  manifest.lastUpdatedBy = 'system:reprocess'
  if (manifest.ariIntelligence) manifest.ariIntelligence.briefingStale = true

  // 11. Save manifest
  const { error: saveErr } = await supabase
    .from('manifests')
    .update({
      manifest,
      priority: manifest.priority,
      current_station: manifest.currentStation,
      qualification_score: manifest.qualificationScore ?? null,
      tier: manifest.tier ?? null,
    })
    .eq('id', manifestId)
  if (saveErr) {
    throw new Error(`Manifest save failed: ${saveErr.message}`)
  }

  // 12. Cascade manifest → leads row
  const cascaded = await cascadeManifestToLead(leadId, lead, manifest, queueRows)
  if (cascaded.length > 0) changed.push(`cascaded=${cascaded.join(',')}`)

  // 13. Backfill lead_activities from queue history (dedup by metadata.mojo_record_id)
  const activitiesAdded = await backfillActivitiesFromQueue(leadId, queueRows, manifest)
  if (activitiesAdded > 0) changed.push(`activities_added=${activitiesAdded}`)

  // 14. Write reprocess activity entry
  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'reprocess',
    description: changed.length > 0 ? `Reprocessed: ${changed.join('; ')}` : 'Reprocessed: no changes',
    metadata: {
      changed,
      skipped,
      errors,
      opportunity_score: manifest.scoring?.opportunity_score ?? null,
      qualification_score: manifest.qualificationScore ?? null,
      triggered_by: 'reprocess_lead',
    },
  })

  return {
    leadId,
    manifestId,
    opportunityScore: manifest.scoring?.opportunity_score ?? null,
    qualificationScore: manifest.qualificationScore ?? null,
    changed,
    skipped,
    errors,
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────

async function loadLatestPpcFormIntelligence(
  leadId: string,
  lead: LeadForPpcIntelligence,
): Promise<PpcLeadIntelligenceInput | null> {
  const { data } = await supabase
    .from('lead_activities')
    .select('metadata, created_at')
    .eq('lead_id', leadId)
    .eq('activity_type', 'status_change')
    .order('created_at', { ascending: false })
    .limit(25)

  const rows = (data ?? []) as PpcActivityMetadataRow[]
  const rank = (source: string | null | undefined): number => {
    if (source === 'ppc_form_submit') return 0
    if (source === 'ppc_form_autosave') return 1
    if (source === 'ppc_form_potential') return 2
    return 99
  }

  const ppcRows = rows
    .map((row) => ({
      metadata: row.metadata,
      createdAt: row.created_at,
      source: typeof row.metadata?.source === 'string' ? row.metadata.source : null,
    }))
    .filter((row) => row.source?.startsWith('ppc_form_'))
    .sort((a, b) => rank(a.source) - rank(b.source) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

  const row = ppcRows[0]
  if (!row) return null

  return ppcLeadIntelligenceFromActivityMetadata(row.metadata, {
    address: lead.property_address ?? null,
    fullName: lead.full_name ?? null,
    city: lead.city ?? null,
    state: lead.state ?? null,
    zip: lead.zip ?? null,
    county: lead.county ?? null,
    capturedAt: row.createdAt ?? null,
  })
}

function ensureManifestArrays(manifest: ManifestV2): ManifestV2 {
  if (!Array.isArray(manifest.contacts)) manifest.contacts = []
  if (!Array.isArray(manifest.notes)) manifest.notes = []
  if (!Array.isArray(manifest.auditTrail)) manifest.auditTrail = []
  if (!manifest.flags) manifest.flags = { redFlags: [] }
  if (!Array.isArray(manifest.flags.redFlags)) manifest.flags.redFlags = []
  if (!manifest.communications) manifest.communications = { transcripts: [] }
  if (!Array.isArray(manifest.communications.transcripts)) manifest.communications.transcripts = []
  if (!Array.isArray(manifest.agentNotes)) manifest.agentNotes = []
  return manifest
}

function transcriptIdForQueueRow(record_id: string): string {
  return `mojo-${record_id}`
}

function transcriptMatchesQueueRow(t: TranscriptEntry, record_id: string): boolean {
  // Match either the canonical reprocess id or the legacy live-path id (mojo-${record_id}-${Date.now()}).
  return t.id === transcriptIdForQueueRow(record_id) || t.id.startsWith(`mojo-${record_id}-`)
}

function ensureTranscriptsFromQueue(manifest: ManifestV2, queueRows: QueueRow[]): number {
  let added = 0
  const transcripts = manifest.communications!.transcripts
  for (const row of queueRows) {
    if (row.status !== 'completed') continue
    const call = row.payload
    const existing = transcripts.find(t => transcriptMatchesQueueRow(t, row.record_id))
    if (existing) continue

    const entry: TranscriptEntry = {
      id: transcriptIdForQueueRow(row.record_id),
      date: call.call_date,
      duration: call.call_duration ?? 0,
      agent: call.agent_name || 'unknown',
      recordingUrl: call.recording_url || null,
      fullTranscript: null,
      transcriptionPending: !!call.recording_url,
      analysisPending: !!call.recording_url,
      aiSummary: null,
      extractedData: null,
      agentNotes: call.notes,
    }
    transcripts.push(entry)
    added++
  }
  return added
}

async function loadTwilioRecordingActivities(leadId: string): Promise<RecordingActivityRow[]> {
  const { data } = await supabase
    .from('lead_activities')
    .select('id, activity_type, description, agent, metadata, created_at')
    .eq('lead_id', leadId)
    .eq('activity_type', 'call')
    .order('created_at', { ascending: true })
    .limit(100)

  return ((data ?? []) as RecordingActivityRow[]).filter((row) => {
    const meta = row.metadata ?? {}
    return Boolean(
      readText(meta.recordingSid) ||
      readText(meta.recordingUrl) ||
      readText(meta.recordingSourceUrl) ||
      readText(meta.RecordingSid) ||
      readText(meta.RecordingUrl),
    )
  })
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function transcriptIdForRecordingActivity(row: RecordingActivityRow): string {
  const meta = row.metadata ?? {}
  return `twilio-${readText(meta.recordingSid) || readText(meta.RecordingSid) || row.id}`
}

function transcriptMatchesRecordingActivity(t: TranscriptEntry, row: RecordingActivityRow): boolean {
  const meta = row.metadata ?? {}
  const sid = readText(meta.recordingSid) || readText(meta.RecordingSid)
  if (t.id === transcriptIdForRecordingActivity(row)) return true
  if (sid && (t.id === `call-${sid}` || t.id === `twilio-${sid}`)) return true
  if (sid && t.recordingUrl?.includes(sid)) return true
  return false
}

function recordingDownloadUrlForActivity(row: RecordingActivityRow): string | null {
  const meta = row.metadata ?? {}
  const sourceUrl = readText(meta.recordingSourceUrl)
  if (sourceUrl) return sourceUrl

  const directUrl = readText(meta.recordingUrl) || readText(meta.RecordingUrl)
  if (directUrl && !directUrl.startsWith('/')) return directUrl

  const sid = readText(meta.recordingSid) || readText(meta.RecordingSid)
  if (sid && process.env.TWILIO_ACCOUNT_SID) {
    return `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${sid}`
  }

  return null
}

function ensureTranscriptsFromRecordingActivities(
  manifest: ManifestV2,
  rows: RecordingActivityRow[],
): number {
  let added = 0
  const transcripts = manifest.communications!.transcripts

  for (const row of rows) {
    if (transcripts.some((t) => transcriptMatchesRecordingActivity(t, row))) continue

    const recordingUrl = recordingDownloadUrlForActivity(row)
    if (!recordingUrl) continue

    const meta = row.metadata ?? {}
    transcripts.push({
      id: transcriptIdForRecordingActivity(row),
      date: row.created_at,
      duration: readNumber(meta.duration) || readNumber(meta.recordingDuration) || readNumber(meta.call_duration),
      agent: row.agent || 'unknown',
      recordingUrl,
      fullTranscript: null,
      transcriptionPending: true,
      analysisPending: true,
      aiSummary: null,
      extractedData: null,
      agentNotes: row.description ?? undefined,
    })
    added++
  }

  return added
}

function mergeAgentNotesFromQueue(manifest: ManifestV2, queueRows: QueueRow[]): number {
  let added = 0
  const notes = manifest.agentNotes!
  const seen = new Set(notes.map(n => n.callRecordId).filter(Boolean))
  for (const row of queueRows) {
    if (row.status !== 'completed') continue
    const call = row.payload
    if (!call.notes || seen.has(row.record_id)) continue
    notes.push({
      timestamp: call.call_date,
      author: call.agent_name?.toLowerCase().includes('casey') ? 'casey' : (call.agent_name || 'unknown'),
      source: 'mojo',
      content: call.notes,
      callRecordId: row.record_id,
    } as any)
    seen.add(row.record_id)
    added++
  }
  return added
}

async function refreshPendingTranscripts(
  manifest: ManifestV2,
  errors: string[],
): Promise<{ transcribed: number; analyzed: number; skipped: number }> {
  let transcribed = 0
  let analyzed = 0
  let skipped = 0

  for (const t of manifest.communications!.transcripts) {
    // Transcribe if recording URL present but transcript missing
    if (t.recordingUrl && !t.fullTranscript) {
      try {
        const audioPath = await downloadRecording(t.recordingUrl, t.id)
        if (!audioPath) { skipped++; continue }
        const text = await transcribeAudio(audioPath)
        if (text) {
          t.fullTranscript = text
          t.transcriptionPending = false
          transcribed++
        } else {
          skipped++
          continue
        }
      } catch (err: any) {
        errors.push(`transcribe_failed[${t.id}]: ${err?.message || String(err)}`)
        skipped++
        continue
      }
    }

    // Analyze if transcript exists but analysis missing
    if (t.fullTranscript && (!t.extractedData || !t.extractedData.motivationScore)) {
      try {
        const analysis = await analyzeCallTranscript(t.fullTranscript, manifest)
        if (analysis) {
          applyAnalysisToTranscript(t, analysis)
          applyAnalysisToManifest(manifest, analysis)
          t.analysisPending = false
          analyzed++
        }
      } catch (err: any) {
        errors.push(`analyze_failed[${t.id}]: ${err?.message || String(err)}`)
      }
    }
  }

  return { transcribed, analyzed, skipped }
}

function applyAnalysisToTranscript(t: TranscriptEntry, a: CallAnalysisResult): void {
  const painPoints = compactStrings([
    ...(a.keyLeverage || []),
    ...(a.emotionalDrivers || []),
    ...(a.objectionsRaised || []),
  ])

  t.aiSummary = a.aiSummary || null
  t.extractedData = {
    motivationScore: a.motivationScore,
    sentiment: a.sentiment as any,
    rapportLevel: a.rapportLevel as any,
    talkRatio: null,
    verbatimQuotes: a.verbatimQuotes,
    objectionResponses: a.objectionsRaised,
    concessionSignals: a.keyLeverage,
    painPoints,
    emotionalDrivers: a.emotionalDrivers,
    nextSteps: a.nextSteps,
    agentCoaching: {
      strengths: a.agentStrengths,
      improvements: a.agentImprovements,
    },
  }
}

function applyAnalysisToManifest(manifest: ManifestV2, a: CallAnalysisResult): void {
  const summary = readText(a.aiSummary) || readText(a.summary)
  if (summary) manifest.situation.summary = summary

  if (a.personalityType && !manifest.owner.personalityType) {
    manifest.owner.personalityType = a.personalityType as ManifestOwner['personalityType']
  }
  if (a.bestTimeToContact) manifest.owner.bestTimeToContact = a.bestTimeToContact
  if (a.coOwners?.length) {
    manifest.owner.coOwners = mergeUniqueStrings(manifest.owner.coOwners, a.coOwners)
  }
  if (a.outOfState != null) manifest.owner.outOfState = a.outOfState

  if (a.communicationStyle) {
    if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
    if (!manifest.ariIntelligence.sellerProfile) manifest.ariIntelligence.sellerProfile = {}
    manifest.ariIntelligence.sellerProfile.communicationStyle = a.communicationStyle
    manifest.ariIntelligence.sellerProfile.personalityType = a.personalityType as any
    if (a.decisionStyle) manifest.ariIntelligence.sellerProfile.decisionStyle = a.decisionStyle
    if (a.emotionalDrivers) manifest.ariIntelligence.sellerProfile.emotionalDrivers = a.emotionalDrivers
  }
  if (a.dealConfidenceScore || a.keyLeverage?.length || a.estimatedARV || a.estimatedRepairsNotes) {
    if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
    if (!manifest.ariIntelligence.dealIntelligence) manifest.ariIntelligence.dealIntelligence = {}
    if (a.dealConfidenceScore) manifest.ariIntelligence.dealIntelligence.confidenceScore = a.dealConfidenceScore
    if (a.keyLeverage) {
      manifest.ariIntelligence.dealIntelligence.keyLeverage = mergeUniqueStrings(
        manifest.ariIntelligence.dealIntelligence.keyLeverage,
        a.keyLeverage,
      )
    }
    if (a.estimatedARV) manifest.ariIntelligence.dealIntelligence.estimatedARV = a.estimatedARV
    if (a.estimatedRepairsNotes) manifest.ariIntelligence.dealIntelligence.estimatedRepairs = a.estimatedRepairsNotes
  }
  if (a.motivationScore || a.motivationSignals?.length || a.keyLeverage?.length || a.emotionalDrivers?.length) {
    if (!manifest.situation.motivation) manifest.situation.motivation = {}
    if (a.motivationScore) manifest.situation.motivation.score = a.motivationScore
    const signals = compactStrings([
      ...(a.motivationSignals || []),
      ...(a.keyLeverage || []),
      ...(a.emotionalDrivers || []),
    ])
    if (signals.length) {
      manifest.situation.motivation.signals = mergeUniqueStrings(manifest.situation.motivation.signals, signals)
      if (!manifest.situation.motivation.primary) manifest.situation.motivation.primary = signals[0]
    }
  }
  if (!manifest.situation.timeline) manifest.situation.timeline = {}
  if (a.urgency) {
    manifest.situation.timeline.urgency = a.urgency as any
    manifest.situation.motivation = manifest.situation.motivation || {}
    manifest.situation.motivation.urgencyLevel = a.urgency as any
  }
  if (a.targetCloseDate) manifest.situation.timeline.targetCloseDate = a.targetCloseDate
  if (a.hardDeadline != null) manifest.situation.timeline.hardDeadline = a.hardDeadline
  if (a.deadlineReason) manifest.situation.timeline.deadlineReason = a.deadlineReason

  if (a.sellerAsking || a.sellerFloor || a.priceFlexibility || a.priceAnchor) {
    if (!manifest.situation.priceExpectations) manifest.situation.priceExpectations = {}
    if (a.sellerAsking) manifest.situation.priceExpectations.sellerAsking = a.sellerAsking
    if (a.sellerFloor) manifest.situation.priceExpectations.sellerFloor = a.sellerFloor
    if (a.priceFlexibility) manifest.situation.priceExpectations.priceFlexibility = a.priceFlexibility as any
    if (a.priceAnchor) manifest.situation.priceExpectations.priceAnchor = a.priceAnchor
  }
  if (a.situationType?.length) {
    for (const tag of a.situationType) {
      if (!manifest.situation.type.includes(tag)) manifest.situation.type.push(tag)
    }
  }
  if (a.objectionsRaised?.length) {
    manifest.situation.objections = mergeUniqueStrings(manifest.situation.objections, a.objectionsRaised)
  }
  if (a.blockers?.length) {
    manifest.situation.blockers = mergeUniqueStrings(manifest.situation.blockers, a.blockers)
  }
  if (a.conditionOverall && !manifest.property.condition?.overall) {
    if (!manifest.property.condition) manifest.property.condition = {}
    manifest.property.condition.overall = a.conditionOverall as any
  }
  if (a.repairsNotes) {
    if (!manifest.property.condition) manifest.property.condition = {}
    manifest.property.condition.notes = mergeText(manifest.property.condition.notes, a.repairsNotes)
  }
  if (a.vacant !== undefined && a.vacant !== null) manifest.property.vacant = a.vacant
  if (a.occupancy && !manifest.property.occupancy) {
    manifest.property.occupancy = a.occupancy as ManifestProperty['occupancy']
  }

  if (a.followUpAction || a.nextSteps?.length) {
    if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
    if (!manifest.ariIntelligence.recommendedActions) manifest.ariIntelligence.recommendedActions = []
    const actions = compactStrings([a.followUpAction, ...(a.nextSteps || [])])
    for (const action of actions.reverse()) {
      if (manifest.ariIntelligence.recommendedActions.some((existing) => existing.action === action)) continue
      manifest.ariIntelligence.recommendedActions.unshift({
        action,
        dateTime: action === a.followUpAction ? a.followUpDateTime : undefined,
        reason: 'transcript_analysis',
      })
    }
  }

  if (a.keyLeverage?.length) {
    manifest.flags.opportunityFlags = mergeUniqueStrings(manifest.flags.opportunityFlags, a.keyLeverage)
  }
}

export function promoteLatestAnalyzedTranscriptToManifest(manifest: ManifestV2): string[] {
  const changed: string[] = []
  const latest = (manifest.communications?.transcripts || [])
    .filter((t) => t.fullTranscript && (t.aiSummary || t.extractedData))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]

  if (!latest) return changed

  const summary = readText(latest.aiSummary)
  if (summary && manifest.situation.summary !== summary) {
    manifest.situation.summary = summary
    changed.push('seller_situation')
  }

  const ex = latest.extractedData
  if (!ex) return changed

  if (ex.motivationScore != null) {
    if (!manifest.situation.motivation) manifest.situation.motivation = {}
    if (manifest.situation.motivation.score !== ex.motivationScore) {
      manifest.situation.motivation.score = ex.motivationScore
      changed.push('motivation_score')
    }
  }

  const signals = compactStrings([
    ...(ex.concessionSignals || []),
    ...(ex.emotionalDrivers || []),
    ...(ex.painPoints || []),
  ])
  if (signals.length) {
    if (!manifest.situation.motivation) manifest.situation.motivation = {}
    const nextSignals = mergeUniqueStrings(manifest.situation.motivation.signals, signals)
    if (nextSignals.length !== (manifest.situation.motivation.signals || []).length) {
      manifest.situation.motivation.signals = nextSignals
      changed.push('motivation_signals')
    }
    if (!manifest.situation.motivation.primary) {
      manifest.situation.motivation.primary = signals[0]
      changed.push('motivation_primary')
    }

    manifest.flags.opportunityFlags = mergeUniqueStrings(manifest.flags.opportunityFlags, signals)
    if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
    if (!manifest.ariIntelligence.dealIntelligence) manifest.ariIntelligence.dealIntelligence = {}
    manifest.ariIntelligence.dealIntelligence.keyLeverage = mergeUniqueStrings(
      manifest.ariIntelligence.dealIntelligence.keyLeverage,
      signals,
    )
  }

  if (ex.objectionResponses?.length) {
    const nextObjections = mergeUniqueStrings(manifest.situation.objections, ex.objectionResponses)
    if (nextObjections.length !== (manifest.situation.objections || []).length) {
      manifest.situation.objections = nextObjections
      changed.push('objections')
    }
  }

  if (ex.nextSteps?.length) {
    if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
    if (!manifest.ariIntelligence.recommendedActions) manifest.ariIntelligence.recommendedActions = []
    for (const action of [...ex.nextSteps].reverse()) {
      if (manifest.ariIntelligence.recommendedActions.some((existing) => existing.action === action)) continue
      manifest.ariIntelligence.recommendedActions.unshift({
        action,
        reason: 'transcript_analysis',
      })
      if (!changed.includes('recommended_actions')) changed.push('recommended_actions')
    }
  }

  return changed
}

function compactStrings(values: unknown[]): string[] {
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
}

function mergeUniqueStrings(current: string[] | undefined, incoming: unknown[]): string[] {
  const out = compactStrings(current || [])
  const seen = new Set(out.map((value) => value.toLowerCase()))
  for (const value of compactStrings(incoming)) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function mergeText(current: unknown, incoming: string): string {
  const next = incoming.trim()
  const existing = typeof current === 'string' ? current.trim() : ''
  if (!existing) return next
  if (!next || existing.toLowerCase().includes(next.toLowerCase())) return existing
  return `${existing}; ${next}`
}

function normalizeLeadMotivationScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  if (rounded < 1) return null
  if (rounded > 10) return 10
  return rounded
}

/**
 * Compute manifest.scoring from available signals.
 * Priority: AI transcript → Mojo disposition → lead-state fallback → keep existing.
 */
function computeScoring(
  manifest: ManifestV2,
  queueRows: QueueRow[],
  lead: any,
): ManifestScoring | null {
  // 1. Most recent transcript with AI analysis
  const transcripts = manifest.communications?.transcripts || []
  const analyzed = transcripts
    .filter(t => t.extractedData?.motivationScore != null)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  if (analyzed.length > 0) {
    const t = analyzed[0]
    const score = clamp(Math.round((t.extractedData!.motivationScore || 0) * 10), 0, 100)
    const classification: ManifestScoring['classification'] =
      score >= 75 ? 'opportunity' : score >= 40 ? 'lead' : 'dead'
    return {
      opportunity_score: score,
      classification,
      reasoning: t.aiSummary || 'AI analysis of call transcript',
      worth_enriching: score >= 60,
      scored_at: new Date().toISOString(),
      scored_by: 'ai',
    }
  }

  // 2. Latest queue row disposition
  const latestCompleted = [...queueRows].reverse().find(r => r.status === 'completed')
  if (latestCompleted) {
    const d = (latestCompleted.payload.disposition || '').toLowerCase()
    const staticScore =
      d.includes('dead') || d.includes('not interested') || d.includes('wrong') ? 0
      : d.includes('appointment') ? 85
      : d.includes('interested') || d.includes('motivated') ? 65
      : d.includes('callback') ? 45
      : d.includes('voicemail') ? 25
      : 20
    const classification: ManifestScoring['classification'] =
      staticScore >= 75 ? 'opportunity' : staticScore >= 40 ? 'lead' : 'dead'
    return {
      opportunity_score: staticScore,
      classification,
      reasoning: `Disposition: ${latestCompleted.payload.disposition}`,
      worth_enriching: staticScore >= 60,
      scored_at: new Date().toISOString(),
      scored_by: 'disposition',
    }
  }

  // 3. Lead-state fallback — handles the Jackie Daniels class: no queue row
  // and no AI'd transcript, but rich lead signals (favorited, appointment set,
  // high motivation, notes like "ready to move forward"). The old code left
  // these leads classification=null, so the UI showed "undetermined."
  const reasons: string[] = []
  let score = 0

  const isFavorite = !!(lead?.is_favorite || (manifest as any).is_favorite)
  const priority = (lead?.priority || manifest.priority || '').toLowerCase()
  const manifestMotivation = manifest.situation?.motivation?.score || 0
  const leadMotivation = lead?.motivation_score || 0
  const motivation = Math.max(manifestMotivation, leadMotivation)
  const hasAppointment = !!manifest.pipeline?.appointment?.scheduledAt
  const station = (lead?.station || manifest.currentStation || '').toLowerCase()
  const notesHaystack = [
    ...(manifest.notes || []).map(n => (n as any).content || ''),
    ...(manifest.agentNotes || []).map(n => n.content || ''),
    lead?.notes || '',
  ].join(' ').toLowerCase()

  if (isFavorite) { score = Math.max(score, 80); reasons.push('favorited') }
  if (hasAppointment) { score = Math.max(score, 75); reasons.push('appointment scheduled') }
  if (motivation >= 8) { score = Math.max(score, 70); reasons.push(`motivation=${motivation}/10`) }
  else if (motivation >= 5) { score = Math.max(score, 50); reasons.push(`motivation=${motivation}/10`) }
  if (/ready|move forward|agreed|let's go|sign|contract|sell now|motivated/i.test(notesHaystack)) {
    score = Math.max(score, 60)
    reasons.push('positive note signals')
  }
  if (priority === 'hot') { score = Math.max(score, 55); reasons.push('priority=hot') }
  else if (priority === 'warm') { score = Math.max(score, 40); reasons.push('priority=warm') }
  if (['appointment', 'offer', 'negotiations', 'contract', 'under_contract'].includes(station)) {
    score = Math.max(score, 65); reasons.push(`station=${station}`)
  } else if (['qualifying', 'discovery', 'valuation', 'research'].includes(station)) {
    score = Math.max(score, 45); reasons.push(`station=${station}`)
  }
  if (/not interested|wrong number|do not call|dnc|disconnected|dead/i.test(notesHaystack)) {
    score = Math.min(score, 15)
    reasons.push('negative note signals')
  }

  if (score > 0) {
    const classification: ManifestScoring['classification'] =
      score >= 75 ? 'opportunity' : score >= 40 ? 'lead' : 'dead'
    return {
      opportunity_score: score,
      classification,
      reasoning: `Lead-state fallback: ${reasons.join(', ')}`,
      worth_enriching: score >= 60,
      scored_at: new Date().toISOString(),
      scored_by: 'notes',
    }
  }

  return manifest.scoring || null
}

/**
 * Cascade manifest state to the leads row. Targets the split-brain fields
 * observed on Thomas Carpenter: opportunity_score, classification, motivation_score,
 * station, priority, transcript (latest), call_result, call_duration_seconds,
 * mojo_record_id, and the property dwelling/assessment columns.
 */
async function cascadeManifestToLead(
  leadId: string,
  currentLead: any,
  manifest: ManifestV2,
  queueRows: QueueRow[],
): Promise<string[]> {
  const updates: Record<string, any> = {}
  const changed: string[] = []

  if (manifest.scoring?.opportunity_score != null && manifest.scoring.opportunity_score !== currentLead.opportunity_score) {
    updates.opportunity_score = manifest.scoring.opportunity_score
    changed.push('opportunity_score')
  }
  if (manifest.scoring?.classification && manifest.scoring.classification !== currentLead.classification) {
    updates.classification = manifest.scoring.classification
    changed.push('classification')
  }
  if (
    manifest.situation?.summary &&
    (!currentLead.seller_situation || String(currentLead.seller_situation).startsWith('PPC intake:'))
  ) {
    updates.seller_situation = manifest.situation.summary
    changed.push('seller_situation')
  }
  const leadMotivationScore = normalizeLeadMotivationScore(manifest.situation?.motivation?.score)
  if (leadMotivationScore !== currentLead.motivation_score) {
    updates.motivation_score = leadMotivationScore
    changed.push('motivation_score')
  }
  if (manifest.currentStation && manifest.currentStation !== currentLead.station) {
    updates.station = manifest.currentStation
    changed.push('station')
  }
  if (manifest.priority && manifest.priority !== currentLead.priority) {
    updates.priority = manifest.priority
    changed.push('priority')
  }

  // Latest transcript / call metadata
  const latestTranscript = (manifest.communications?.transcripts || [])
    .filter(t => !!t.fullTranscript)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
  const latestDurationTranscript = (manifest.communications?.transcripts || [])
    .filter(t => !!t.fullTranscript && Number(t.duration) > 0)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
  if (latestTranscript?.fullTranscript && latestTranscript.fullTranscript !== currentLead.transcript) {
    updates.transcript = latestTranscript.fullTranscript
    changed.push('transcript')
  }
  if (latestDurationTranscript?.duration != null && latestDurationTranscript.duration !== currentLead.call_duration_seconds) {
    updates.call_duration_seconds = latestDurationTranscript.duration
    changed.push('call_duration_seconds')
  }

  const latestQueue = [...queueRows].reverse().find(r => r.status === 'completed')
  if (latestQueue) {
    if (latestQueue.record_id !== currentLead.mojo_record_id) {
      updates.mojo_record_id = latestQueue.record_id
      changed.push('mojo_record_id')
    }
    if (latestQueue.payload.disposition && latestQueue.payload.disposition !== currentLead.call_result) {
      updates.call_result = latestQueue.payload.disposition
      changed.push('call_result')
    }
  }

  // Property fields from manifest dwelling/assessment (only if lead is missing them).
  // Number-coerce + round because scrapers return floats (e.g. 3.0 bedrooms, 5.2
  // bathrooms, 8430.5 sqft) but the leads columns are integers.
  const dwell = manifest.property?.dwelling
  const assess = manifest.property?.assessment
  if (dwell?.bedrooms && !currentLead.beds) { updates.beds = Math.round(Number(dwell.bedrooms)); changed.push('beds') }
  if (dwell?.bathrooms && !currentLead.baths_full) { updates.baths_full = Math.round(Number(dwell.bathrooms)); changed.push('baths_full') }
  if (dwell?.sqft && !currentLead.sqft) { updates.sqft = Math.round(Number(dwell.sqft)); changed.push('sqft') }
  if (dwell?.yearBuilt && !currentLead.year_built) { updates.year_built = Math.round(Number(dwell.yearBuilt)); changed.push('year_built') }
  const appraisedTotal = assess?.appraisedTotal ?? assess?.totalValue
  const assessedTotal = assess?.assessedTotal ?? assess?.totalValue
  if (appraisedTotal && !currentLead.arv) { updates.arv = Math.round(Number(appraisedTotal)); changed.push('arv') }
  if (assessedTotal && !currentLead.assessed_value) { updates.assessed_value = Math.round(Number(assessedTotal)); changed.push('assessed_value') }

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase.from('leads').update(updates).eq('id', leadId)
    if (error) {
      console.error(`[reprocess] Lead cascade update failed: ${error.message}`)
      return []
    }
  }

  return changed
}

/**
 * Write lead_activities rows for historical Mojo calls that are missing from
 * the activity stream. Dedup key: metadata.mojo_record_id.
 */
async function backfillActivitiesFromQueue(
  leadId: string,
  queueRows: QueueRow[],
  manifest: ManifestV2,
): Promise<number> {
  if (queueRows.length === 0) return 0

  const { data: existingActivities } = await supabase
    .from('lead_activities')
    .select('metadata')
    .eq('lead_id', leadId)
    .in('activity_type', ['call', 'voicemail', 'appointment', 'follow_up'])

  const existingRecordIds = new Set<string>()
  for (const a of existingActivities || []) {
    const rid = (a as any).metadata?.mojo_record_id
    if (rid) existingRecordIds.add(rid)
  }

  const inserts: any[] = []
  for (const row of queueRows) {
    if (row.status !== 'completed') continue
    if (existingRecordIds.has(row.record_id)) continue

    const call = row.payload
    const dispo = (call.disposition || '').toLowerCase()
    let activityType: string = 'call'
    if (dispo.includes('appointment')) activityType = 'appointment'
    else if (dispo.includes('voicemail')) activityType = 'voicemail'
    else if (dispo.includes('callback')) activityType = 'follow_up'

    const transcript = manifest.communications?.transcripts.find(
      t => transcriptMatchesQueueRow(t, row.record_id),
    )

    inserts.push({
      lead_id: leadId,
      activity_type: activityType,
      description: call.notes || `${call.disposition} — ${call.agent_name} (${call.call_duration}s)`,
      metadata: {
        mojo_record_id: row.record_id,
        agent_name: call.agent_name,
        disposition: call.disposition,
        call_duration: call.call_duration,
        call_date: call.call_date,
        direction: 'outbound',
        source: 'mojo',
        recording_url: call.recording_url || null,
        transcript_id: transcript?.id || null,
        backfilled: true,
      },
      created_at: call.call_date,
    })
  }

  if (inserts.length === 0) return 0

  const { error } = await supabase.from('lead_activities').insert(inserts)
  if (error) {
    console.error(`[reprocess] Backfill activities failed: ${error.message}`)
    return 0
  }
  return inserts.length
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

const STREET_SUFFIX_RE = / (RD|ST|AVE|BLVD|TER|LN|DR|CT|PL|WAY|PKWY|CIR|HWY|TRL|LOOP|RUN|ROW|XING|PATH)\b/i

function looksLikeSplitAddress(propertyAddress: string | null | undefined, city: string | null | undefined): boolean {
  if (!propertyAddress || !city) return false
  return /^\d+$/.test(propertyAddress.trim()) && STREET_SUFFIX_RE.test(city)
}

/**
 * Repair leads where property_address is only a house number and city contains
 * the rest of the street name. Uses prospect_phones for the canonical address.
 * Mutates the passed `lead` object and `manifest.property` to reflect the fix.
 */
async function healSplitAddress(
  leadId: string,
  lead: any,
  manifest: ManifestV2,
  errors: string[],
): Promise<string[]> {
  if (!looksLikeSplitAddress(lead.property_address, lead.city)) return []
  if (!lead.phone) return []

  const digits = String(lead.phone).replace(/\D/g, '')
  const last10 = digits.slice(-10)
  if (last10.length !== 10) return []

  const { data: matches, error } = await supabase
    .from('prospect_phones')
    .select('phone, prospects(situs_street, situs_city, situs_state, situs_zip, county, parcel_id)')
    .like('phone', `%${last10}%`)
    .limit(1)

  if (error) {
    errors.push(`prospect_lookup_failed: ${error.message}`)
    return []
  }
  const p = matches?.[0]?.prospects as any
  if (!p?.situs_street) return []

  const updates: Record<string, any> = {
    property_address: p.situs_street,
    city: p.situs_city || lead.city,
  }
  if (p.situs_state) updates.state = p.situs_state
  if (p.situs_zip) updates.zip = p.situs_zip
  if (p.county) updates.county = p.county
  if (p.parcel_id) updates.parcel_id = p.parcel_id

  const { error: upErr } = await supabase.from('leads').update(updates).eq('id', leadId)
  if (upErr) {
    errors.push(`address_heal_update_failed: ${upErr.message}`)
    return []
  }

  // Reflect on the in-memory lead and manifest so downstream enrichment uses
  // the corrected values.
  Object.assign(lead, updates)
  if (!manifest.property) manifest.property = {}
  manifest.property.address = p.situs_street
  if (p.parcel_id) manifest.property.parcel = p.parcel_id

  return Object.keys(updates)
}

/**
 * Parse city/state/zip from a combined property_address when the lead row
 * has them missing. Uses the shared parseAddressForCounty helper which
 * matches known KC-metro city names and MO/KS state patterns.
 * Synchronous, in-memory only — caller persists via subsequent lead update
 * (the prospect hydrator flushes everything with a single update).
 */
async function parseAddressFromPropertyString(
  leadId: string,
  lead: any,
): Promise<string[]> {
  if (!lead.property_address) return []
  if (lead.city && lead.state && lead.county) return []
  const parsed = parseAddressForCounty(lead.property_address)
  if (!parsed) return []
  const updates: Record<string, any> = {}
  if (!lead.city && parsed.city) updates.city = parsed.city
  if (!lead.state && parsed.state) updates.state = parsed.state
  if (!lead.zip && parsed.zip) updates.zip = parsed.zip
  if (!lead.county && parsed.county) updates.county = parsed.county.toLowerCase()
  if (Object.keys(updates).length === 0) return []
  const { error } = await supabase.from('leads').update(updates).eq('id', leadId)
  if (error) {
    console.error(`[reprocess] parseAddress update failed: ${error.message}`)
    return []
  }
  Object.assign(lead, updates)
  return Object.keys(updates)
}

/**
 * Hydrate the lead + manifest from the prospects table. Runs for every lead
 * with a phone (not gated on split-address pattern). Fills only missing fields,
 * so it's safe to re-run. Populates county/parcel/arv/assessed_value fields
 * that the on-demand county scrapers often fail to return (Jackson in
 * particular has a flaky ASP.NET form that returns valuation but not dwelling).
 */
async function hydrateFromProspect(
  leadId: string,
  lead: any,
  manifest: ManifestV2,
  errors: string[],
): Promise<string[]> {
  if (!lead.phone) return []
  const changed: string[] = []

  // Match prospect by phone (exact first, then last-10 fallback)
  let prospect: any = null
  const { data: exact } = await supabase
    .from('prospect_phones')
    .select('prospects(parcel_id, county, total_market_value, zestimate, situs_street, situs_city, situs_state, situs_zip, cumulative_due, earliest_delinquent_year, occupancy_status, owner_1)')
    .eq('phone', lead.phone)
    .limit(1)
  if (exact && exact[0]?.prospects) {
    prospect = (exact[0] as any).prospects
  } else {
    const last10 = String(lead.phone).replace(/\D/g, '').slice(-10)
    if (last10.length === 10) {
      const { data: fuzzy } = await supabase
        .from('prospect_phones')
        .select('prospects(parcel_id, county, total_market_value, zestimate, situs_street, situs_city, situs_state, situs_zip, cumulative_due, earliest_delinquent_year, occupancy_status, owner_1)')
        .like('phone', `%${last10}%`)
        .limit(1)
      if (fuzzy && fuzzy[0]?.prospects) prospect = (fuzzy[0] as any).prospects
    }
  }

  if (!prospect) return []

  const updates: Record<string, any> = {}

  // Only fill missing lead fields by default. Exception: county/state
  // compatibility wins over stale row data, e.g. Johnson County must be KS.
  if (!lead.county && prospect.county) updates.county = prospect.county
  if (!lead.parcel_id && prospect.parcel_id) updates.parcel_id = prospect.parcel_id
  if (!lead.zip && prospect.situs_zip) updates.zip = String(prospect.situs_zip)
  // ARV fallback: prefer zestimate (market), fall back to total_market_value (assessor)
  const prospectArv = Number(prospect.zestimate || prospect.total_market_value || 0)
  if (!lead.arv && prospectArv > 0) updates.arv = prospectArv
  if (!lead.assessed_value && Number(prospect.total_market_value) > 0) {
    updates.assessed_value = Number(prospect.total_market_value)
  }
  if (!lead.property_address && prospect.situs_street) updates.property_address = prospect.situs_street
  if (!lead.city && prospect.situs_city) updates.city = prospect.situs_city
  const expectedState = expectedStateForCounty(prospect.county || lead.county)
  const prospectState = normalizeState(prospect.situs_state)
  const leadState = normalizeState(lead.state)
  if (expectedState && leadState !== expectedState) updates.state = expectedState
  else if (!leadState && prospectState) updates.state = prospectState

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase.from('leads').update(updates).eq('id', leadId)
    if (error) {
      errors.push(`prospect_hydrate_update_failed: ${error.message}`)
      return []
    }
    Object.assign(lead, updates)
    changed.push(...Object.keys(updates))
  }

  // Manifest property hydration (so the scoring engine sees the same data)
  if (!manifest.property) manifest.property = {} as any
  if (!manifest.property.address && prospect.situs_street) manifest.property.address = prospect.situs_street
  if (!manifest.property.parcel && prospect.parcel_id) manifest.property.parcel = prospect.parcel_id
  if (!manifest.property.assessment) manifest.property.assessment = {} as any
  if (!manifest.property.assessment!.totalValue && prospectArv > 0) {
    manifest.property.assessment!.totalValue = prospectArv
  }
  if (!manifest.property.assessment!.appraisedTotal && prospectArv > 0) {
    manifest.property.assessment!.appraisedTotal = prospectArv
  }
  if (!manifest.property.occupancy && prospect.occupancy_status) {
    const occ = String(prospect.occupancy_status).toLowerCase()
    manifest.property.occupancy = occ.includes('owner') ? 'owner' : occ.includes('tenant') ? 'tenant' : occ.includes('vacant') ? 'vacant' : null
  }

  // Tax-delinquency flag for Hot Engine's quality scoring
  if (prospect.cumulative_due && Number(prospect.cumulative_due) > 0) {
    if (!manifest.property.taxCollector) manifest.property.taxCollector = {} as any
    manifest.property.taxCollector!.totalOwed = Number(prospect.cumulative_due)
    manifest.property.taxCollector!.delinquentAmount = Number(prospect.cumulative_due)
    if (prospect.earliest_delinquent_year) {
      const yearsDelinquent = new Date().getFullYear() - Number(prospect.earliest_delinquent_year)
      if (yearsDelinquent > 0) manifest.property.taxCollector!.yearsDelinquent = yearsDelinquent
    }
    if (!manifest.flags.redFlags?.includes('tax_delinquent')) {
      manifest.flags.redFlags = [...(manifest.flags.redFlags || []), 'tax_delinquent']
    }
  }

  return changed
}

function normalizeState(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null
}

function expectedStateForCounty(county?: string | null): 'KS' | 'MO' | null {
  const normalized = county?.toLowerCase().trim()
  if (!normalized) return null
  if (['johnson', 'wyandotte', 'leavenworth', 'miami', 'douglas'].includes(normalized)) return 'KS'
  if (['jackson', 'clay', 'platte'].includes(normalized)) return 'MO'
  return null
}

/**
 * Fetch the most recent reprocess result for a lead.
 */
export async function getLastReprocessResult(leadId: string): Promise<any | null> {
  const { data } = await supabase
    .from('lead_activities')
    .select('description, metadata, created_at')
    .eq('lead_id', leadId)
    .eq('activity_type', 'reprocess')
    .order('created_at', { ascending: false })
    .limit(1)
  return data && data.length > 0 ? data[0] : null
}
