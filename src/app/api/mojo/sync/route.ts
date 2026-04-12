import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildManifest } from '@/lib/manifest-builder'
import { detectCounty } from '@/lib/county-enrichment'
import { enrichManifestProperty, scoreManifest } from '@/lib/manifest-enrichment'
import type { ManifestV2, ManifestScoring, ManifestContact, TranscriptEntry, ManifestAgentNote, ManifestOwner, ManifestProperty, ManifestSituation } from '@/lib/manifest-builder'
import { downloadRecording } from '@/lib/mojo-recording-downloader'
import { transcribeAudio } from '@/lib/mojo-transcriber'
import { analyzeCallTranscript, type CallAnalysisResult } from '@/lib/mojo-call-analyzer'
import { safeSendSMS } from '@/lib/safe-communications'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface MojoCallRecord {
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
  list_name?: string
  campaign_name?: string
  recording_url?: string
  follow_up_date?: string
  email?: string
}

interface DispositionMapping {
  outcome: string
  priority?: 'hot' | 'warm' | 'cold'
  alertErnest?: boolean
  createAppointment?: boolean
  incrementAttempts?: boolean
  flag?: string
  isDead?: boolean
}

// Map Mojo dispositions to manifest fields
function mapDisposition(disposition: string): DispositionMapping {
  const d = disposition.toLowerCase()

  if (d.includes('callback') || d === 'callback requested') {
    return { outcome: 'callback_scheduled', priority: 'warm' }
  }
  if (d === 'interested' || d.includes('motivated')) {
    return { outcome: 'meaningful_conversation', priority: 'hot', alertErnest: true }
  }
  if (d.includes('appointment') || d === 'appointment set') {
    return { outcome: 'appointment_set', priority: 'hot', alertErnest: true, createAppointment: true }
  }
  if (d === 'not interested' || d.includes('not interested')) {
    return { outcome: 'not_interested', isDead: true }
  }
  if (d === 'wrong number') {
    return { outcome: 'wrong_number', isDead: true, flag: 're_skip_trace' }
  }
  if (d === 'disconnected') {
    return { outcome: 'disconnected', isDead: true, flag: 're_skip_trace' }
  }
  if (d === 'no answer') {
    return { outcome: 'no_answer', incrementAttempts: true }
  }
  if (d.includes('voicemail')) {
    return { outcome: 'voicemail_left', incrementAttempts: true }
  }
  if (d === 'dnc request' || d.includes('do not call')) {
    return { outcome: 'dnc', isDead: true }
  }
  if (d === 'already sold' || d.includes('sold')) {
    return { outcome: 'already_sold', isDead: true }
  }
  if (d.includes('listed') || d.includes('agent')) {
    return { outcome: 'listed', priority: 'cold' }
  }
  if (d === 'busy') {
    return { outcome: 'busy' }
  }

  return { outcome: 'other' }
}

// Score a call using agent notes + manifest state (middle case: notes but no recording)
function scoreFromNotes(call: MojoCallRecord, manifest: ManifestV2): { score: number; reasoning: string } {
  let score = 0
  const reasons: string[] = []
  const notes = (call.notes || '').toLowerCase()
  const dispositionLower = call.disposition.toLowerCase()

  // Pain/motivation: up to 40 points
  const painKeywords = ['motivation', 'motivated', 'needs to sell', 'must sell', 'wants to sell',
    'ready', 'problem', 'behind', 'tax', 'foreclos', 'divorce', 'inherited', 'moving',
    'relocation', 'financial', 'distress', 'tired', 'landlord', 'vacant']
  const hasPain = painKeywords.some(k => notes.includes(k))
    || !!(manifest.situation?.motivation?.primary)
    || (manifest.situation?.motivation?.signals?.length ?? 0) > 0
    || (manifest.situation?.type?.length ?? 0) > 0
  if (hasPain) {
    score += 40
    reasons.push('pain/motivation confirmed')
  }

  // Timeline with urgency: up to 30 points
  const urgencyKeywords = ['asap', 'urgent', 'this week', 'next week', 'day', 'deadline',
    '30', '60', 'immediately', 'right away', 'by ']
  const hasUrgentTimeline = urgencyKeywords.some(k => notes.includes(k))
    || ['high', 'critical'].includes(manifest.situation?.timeline?.urgency || '')
    || !!manifest.situation?.timeline?.hardDeadline
  if (hasUrgentTimeline) {
    score += 30
    reasons.push('timeline with urgency stated')
  }

  // Next step locked in: up to 30 points
  const nextStepKeywords = ['appointment', 'callback', 'call back', 'follow up', 'follow-up', 'scheduled', 'set up']
  const hasNextStep = nextStepKeywords.some(k => notes.includes(k))
    || dispositionLower.includes('appointment')
    || dispositionLower.includes('callback')
    || !!manifest.pipeline?.appointment
  if (hasNextStep) {
    score += 30
    reasons.push('next step confirmed')
  }

  const reasoning = reasons.length > 0 ? reasons.join('; ') : 'no qualifying signals in notes'
  return { score, reasoning }
}

// Normalize phone number to E164 format
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) {
    return `+1${digits}`
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }
  return `+${digits}`
}

// Parse contact name into first/last
function parseContactName(fullName: string): { firstName: string; lastName?: string } {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 0) return { firstName: 'Unknown' }
  if (parts.length === 1) return { firstName: parts[0] }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

// Send SMS alert
async function sendAlert(name: string, address: string, disposition: string, score?: number) {
  const scoreText = score ? ` Score: ${score}` : ''
  const smsText = `🔥 Hot lead from Casey: ${name} at ${address} — ${disposition}.${scoreText}`

  try {
    await safeSendSMS({
      body: smsText,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: process.env.ERNEST_PHONE!,
    })
    return true
  } catch (err) {
    console.error('Failed to send alert:', err)
    return false
  }
}

// Queue briefing regeneration
function queueBriefingRegeneration(manifest: ManifestV2) {
  const now = new Date().toISOString()

  if (!manifest.ariIntelligence) {
    manifest.ariIntelligence = {
      sellerProfile: {},
      dealIntelligence: {},
      recommendedActions: [],
      briefingStale: true,
    }
  } else {
    manifest.ariIntelligence.briefingStale = true
  }

  manifest.auditTrail.push({
    timestamp: now,
    agent: 'system:mojo-sync-phase2',
    action: 'briefing_queued',
    details: { reason: 'new_call_analysis' },
  })
}

// Merge arrays without duplicates
function mergeArrays<T>(existing: T[] | undefined, newItems: T[] | undefined): T[] {
  if (!newItems || newItems.length === 0) return existing || []
  if (!existing || existing.length === 0) return newItems

  const merged = [...existing]
  for (const item of newItems) {
    if (!merged.includes(item)) {
      merged.push(item)
    }
  }
  return merged
}

// Process Phase 2: Recording → Transcription → Analysis → Manifest Update
async function processPhase2Intelligence(
  call: MojoCallRecord,
  manifest: ManifestV2,
  manifestId: string
): Promise<ManifestV2> {
  const now = new Date().toISOString()

  try {
    // Initialize structures if missing
    if (!manifest.agentNotes) manifest.agentNotes = []
    if (!manifest.communications) manifest.communications = { transcripts: [] }
    if (!manifest.ariIntelligence) {
      manifest.ariIntelligence = {
        sellerProfile: {},
        dealIntelligence: {},
        recommendedActions: [],
        briefingStale: false,
      }
    }

    // Handle agent notes from Mojo
    if (call.notes) {
      const agentNote: ManifestAgentNote = {
        timestamp: call.call_date,
        author: 'casey',
        source: 'mojo',
        content: call.notes,
        callRecordId: call.record_id,
      }
      manifest.agentNotes.push(agentNote)

      // Extract callback time from notes
      const callbackMatch = call.notes.match(/callback.*?(\d{1,2}:\d{2}\s*(?:am|pm)?)/i)
      if (callbackMatch) {
        const action = {
          action: `Call back at ${callbackMatch[1]}`,
          reason: 'seller_requested',
        }
        if (!manifest.ariIntelligence.recommendedActions) {
          manifest.ariIntelligence.recommendedActions = []
        }
        manifest.ariIntelligence.recommendedActions.push(action)
      }

      // Handle follow-up date from Mojo
      if (call.follow_up_date) {
        if (!manifest.situation.timeline) manifest.situation.timeline = {}
        manifest.situation.timeline.targetCloseDate = call.follow_up_date
        if (!manifest.ariIntelligence.recommendedActions) {
          manifest.ariIntelligence.recommendedActions = []
        }
        const followUpTime = new Date(call.follow_up_date).toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        })
        manifest.ariIntelligence.recommendedActions.push({
          action: `Follow-up call scheduled: ${followUpTime}`,
          reason: 'agent_scheduled',
        })
        console.log(`[mojo/sync] Follow-up set for ${call.contact_name}: ${followUpTime}`)
      }

      // === Extract structured seller intel from Casey's notes ===
      const notes = call.notes
      const timelineMatch = notes.match(/Timeline:\s*(.+?)(?=\s*(?:Condition:|Price:|Motivation:|Appointment:|$))/i)
      const conditionMatch = notes.match(/Condition:\s*(.+?)(?=\s*(?:Timeline:|Price:|Motivation:|Appointment:|$))/i)
      const priceMatch = notes.match(/Price:\s*(.+?)(?=\s*(?:Timeline:|Condition:|Motivation:|Appointment:|$))/i)
      const motivationMatch = notes.match(/Motivation:\s*(.+?)(?=\s*(?:Timeline:|Condition:|Price:|Appointment:|$))/i)

      if (timelineMatch || conditionMatch || priceMatch || motivationMatch) {
        console.log(`[mojo/sync] Extracting seller intel from agent notes for ${call.contact_name}`)

        if (timelineMatch) {
          if (!manifest.situation.timeline) manifest.situation.timeline = {}
          ;(manifest.situation.timeline as any).notes = timelineMatch[1].trim()
          const tl = timelineMatch[1].toLowerCase()
          if (tl.includes('asap') || tl.includes('immediate') || tl.includes('urgent')) {
            manifest.situation.timeline.urgency = 'high'
          } else if (tl.includes('30') || tl.includes('60') || tl.includes('soon')) {
            manifest.situation.timeline.urgency = 'medium'
          }
        }

        if (conditionMatch) {
          if (!manifest.property.condition) manifest.property.condition = {} as any
          manifest.property.condition!.notes = conditionMatch[1].trim()
        }

        if (priceMatch) {
          if (!manifest.situation.priceExpectations) manifest.situation.priceExpectations = {}
          ;(manifest.situation.priceExpectations as any).notes = priceMatch[1].trim()
          const amounts = priceMatch[1].match(/\$[\d,]+k?|\d[\d,]*k/gi)
          if (amounts) {
            const nums = amounts.map(a => {
              const n = parseFloat(a.replace(/[$,]/g, ''))
              return a.toLowerCase().includes('k') ? n * 1000 : (n < 1000 ? n * 1000 : n)
            }).sort((a, b) => b - a)
            if (nums.length >= 1) manifest.situation.priceExpectations.sellerAsking = nums[0]
            if (nums.length >= 2) manifest.situation.priceExpectations.sellerFloor = nums[nums.length - 1]
          }
        }

        if (motivationMatch) {
          if (!manifest.situation.motivation) manifest.situation.motivation = {}
          ;(manifest.situation.motivation as any).notes = motivationMatch[1].trim()
        }

        manifest.auditTrail.push({
          timestamp: new Date().toISOString(),
          agent: 'system:mojo_note_parser',
          action: 'seller_intel_extracted_from_notes',
          details: {
            hasTimeline: !!timelineMatch,
            hasCondition: !!conditionMatch,
            hasPrice: !!priceMatch,
            hasMotivation: !!motivationMatch,
          },
        })
      }
    }

    // Skip Phase 2 intelligence if no recording URL
    if (!call.recording_url) {
      console.log(`[mojo/sync] No recording URL for call ${call.record_id} — using note-extracted intel only`)
      return manifest
    }

    // Step 1: Download recording
    const audioPath = await downloadRecording(call.recording_url, call.record_id)

    let transcriptText: string | null = null
    let analysisResult: CallAnalysisResult | null = null

    // Step 2: Transcribe
    if (audioPath) {
      transcriptText = await transcribeAudio(audioPath)

      // Step 3: Analyze transcript
      if (transcriptText) {
        analysisResult = await analyzeCallTranscript(transcriptText, manifest)
      }
    }

    // Step 4: Write transcript entry
    const transcriptEntry: TranscriptEntry = {
      id: `mojo-${call.record_id}-${Date.now()}`,
      date: call.call_date,
      duration: call.call_duration,
      agent: call.agent_name,
      recordingUrl: call.recording_url || null,
      fullTranscript: transcriptText || null,
      transcriptionPending: !transcriptText && !!call.recording_url,
      analysisPending: !analysisResult && !!transcriptText,
      aiSummary: analysisResult?.aiSummary || null,
      extractedData: analysisResult ? {
        motivationScore: analysisResult.motivationScore,
        sentiment: analysisResult.sentiment,
        rapportLevel: analysisResult.rapportLevel,
        talkRatio: null,
        verbatimQuotes: analysisResult.verbatimQuotes,
        objectionResponses: analysisResult.objectionsRaised,
        concessionSignals: analysisResult.keyLeverage,
        agentCoaching: {
          strengths: analysisResult.agentStrengths,
          improvements: analysisResult.agentImprovements,
        },
      } : null,
      agentNotes: call.notes,
    }

    manifest.communications.transcripts.push(transcriptEntry)

    // Step 5: Update manifest fields from analysis
    if (analysisResult) {
      if (analysisResult.bestTimeToContact && !manifest.owner.bestTimeToContact) {
        manifest.owner.bestTimeToContact = analysisResult.bestTimeToContact
      }
      if (analysisResult.personalityType && !manifest.owner.personalityType) {
        manifest.owner.personalityType = analysisResult.personalityType as ManifestOwner['personalityType']
      }
      if (analysisResult.coOwners && analysisResult.coOwners.length > 0) {
        manifest.owner.coOwners = mergeArrays(manifest.owner.coOwners, analysisResult.coOwners)
      }
      if (analysisResult.outOfState !== undefined && analysisResult.outOfState !== null) {
        manifest.owner.outOfState = analysisResult.outOfState
      }
      if (analysisResult.alternatePhonesFound && analysisResult.alternatePhonesFound.length > 0) {
        for (const phone of analysisResult.alternatePhonesFound) {
          const normalized = normalizePhone(phone)
          if (!manifest.owner.phones.includes(normalized)) {
            manifest.owner.phones.push(normalized)
          }
        }
      }

      if (analysisResult.vacant !== undefined && analysisResult.vacant !== null) {
        manifest.property.vacant = analysisResult.vacant
      }
      if (analysisResult.occupancy && !manifest.property.occupancy) {
        manifest.property.occupancy = analysisResult.occupancy as ManifestProperty['occupancy']
      }
      if (analysisResult.conditionOverall && !manifest.property.condition) {
        manifest.property.condition = { overall: analysisResult.conditionOverall as NonNullable<ManifestProperty['condition']>['overall'] }
      } else if (analysisResult.conditionOverall && manifest.property.condition && !manifest.property.condition.overall) {
        manifest.property.condition.overall = analysisResult.conditionOverall as NonNullable<ManifestProperty['condition']>['overall']
      }
      if (analysisResult.repairsNotes && manifest.property.condition) {
        if (!manifest.property.condition.notes) {
          manifest.property.condition.notes = analysisResult.repairsNotes
        }
      }

      if (analysisResult.situationType && analysisResult.situationType.length > 0) {
        manifest.situation.type = mergeArrays(manifest.situation.type, analysisResult.situationType)
      }
      if (analysisResult.motivationScore !== undefined && analysisResult.motivationScore !== null) {
        if (!manifest.situation.motivation) manifest.situation.motivation = {}
        manifest.situation.motivation.score = analysisResult.motivationScore
      }
      if (analysisResult.motivationSignals && analysisResult.motivationSignals.length > 0) {
        if (!manifest.situation.motivation) manifest.situation.motivation = {}
        manifest.situation.motivation.signals = mergeArrays(
          manifest.situation.motivation.signals,
          analysisResult.motivationSignals
        )
      }
      if (analysisResult.urgency) {
        if (!manifest.situation.timeline) manifest.situation.timeline = {}
        manifest.situation.timeline.urgency = analysisResult.urgency as NonNullable<ManifestSituation['timeline']>['urgency']
      }
      if (analysisResult.targetCloseDate) {
        if (!manifest.situation.timeline) manifest.situation.timeline = {}
        manifest.situation.timeline.targetCloseDate = analysisResult.targetCloseDate
      }
      if (analysisResult.hardDeadline !== undefined) {
        if (!manifest.situation.timeline) manifest.situation.timeline = {}
        manifest.situation.timeline.hardDeadline = analysisResult.hardDeadline
      }
      if (analysisResult.deadlineReason) {
        if (!manifest.situation.timeline) manifest.situation.timeline = {}
        manifest.situation.timeline.deadlineReason = analysisResult.deadlineReason
      }
      if (analysisResult.sellerAsking !== undefined && analysisResult.sellerAsking !== null) {
        if (!manifest.situation.priceExpectations) manifest.situation.priceExpectations = {}
        manifest.situation.priceExpectations.sellerAsking = analysisResult.sellerAsking
      }
      if (analysisResult.sellerFloor !== undefined && analysisResult.sellerFloor !== null) {
        if (!manifest.situation.priceExpectations) manifest.situation.priceExpectations = {}
        manifest.situation.priceExpectations.sellerFloor = analysisResult.sellerFloor
      }
      if (analysisResult.priceFlexibility) {
        if (!manifest.situation.priceExpectations) manifest.situation.priceExpectations = {}
        manifest.situation.priceExpectations.priceFlexibility = analysisResult.priceFlexibility as NonNullable<ManifestSituation['priceExpectations']>['priceFlexibility']
      }
      if (analysisResult.priceAnchor) {
        if (!manifest.situation.priceExpectations) manifest.situation.priceExpectations = {}
        manifest.situation.priceExpectations.priceAnchor = analysisResult.priceAnchor
      }
      if (analysisResult.blockers && analysisResult.blockers.length > 0) {
        manifest.situation.blockers = mergeArrays(manifest.situation.blockers, analysisResult.blockers)
      }
      if (analysisResult.objectionsRaised && analysisResult.objectionsRaised.length > 0) {
        manifest.situation.objections = mergeArrays(manifest.situation.objections, analysisResult.objectionsRaised)
      }

      if (analysisResult.personalityType) {
        if (!manifest.ariIntelligence.sellerProfile) manifest.ariIntelligence.sellerProfile = {}
        manifest.ariIntelligence.sellerProfile.personalityType = analysisResult.personalityType
      }
      if (analysisResult.communicationStyle) {
        if (!manifest.ariIntelligence.sellerProfile) manifest.ariIntelligence.sellerProfile = {}
        manifest.ariIntelligence.sellerProfile.communicationStyle = analysisResult.communicationStyle
      }
      if (analysisResult.decisionStyle) {
        if (!manifest.ariIntelligence.sellerProfile) manifest.ariIntelligence.sellerProfile = {}
        manifest.ariIntelligence.sellerProfile.decisionStyle = analysisResult.decisionStyle
      }
      if (analysisResult.emotionalDrivers && analysisResult.emotionalDrivers.length > 0) {
        if (!manifest.ariIntelligence.sellerProfile) manifest.ariIntelligence.sellerProfile = {}
        manifest.ariIntelligence.sellerProfile.emotionalDrivers = mergeArrays(
          manifest.ariIntelligence.sellerProfile.emotionalDrivers,
          analysisResult.emotionalDrivers
        )
      }
      if (analysisResult.keyLeverage && analysisResult.keyLeverage.length > 0) {
        if (!manifest.ariIntelligence.dealIntelligence) manifest.ariIntelligence.dealIntelligence = {}
        manifest.ariIntelligence.dealIntelligence.keyLeverage = mergeArrays(
          manifest.ariIntelligence.dealIntelligence.keyLeverage,
          analysisResult.keyLeverage
        )
      }
      if (analysisResult.dealConfidenceScore !== undefined && analysisResult.dealConfidenceScore !== null) {
        if (!manifest.ariIntelligence.dealIntelligence) manifest.ariIntelligence.dealIntelligence = {}
        manifest.ariIntelligence.dealIntelligence.confidenceScore = analysisResult.dealConfidenceScore
      }
      if (analysisResult.estimatedARV !== undefined && analysisResult.estimatedARV !== null) {
        if (!manifest.ariIntelligence.dealIntelligence) manifest.ariIntelligence.dealIntelligence = {}
        manifest.ariIntelligence.dealIntelligence.estimatedARV = analysisResult.estimatedARV
      }
      if (analysisResult.estimatedRepairsNotes) {
        if (!manifest.ariIntelligence.dealIntelligence) manifest.ariIntelligence.dealIntelligence = {}
        manifest.ariIntelligence.dealIntelligence.estimatedRepairs = analysisResult.estimatedRepairsNotes
      }

      if (analysisResult.followUpAction) {
        if (!manifest.ariIntelligence.recommendedActions) manifest.ariIntelligence.recommendedActions = []
        manifest.ariIntelligence.recommendedActions.push({
          action: analysisResult.followUpAction,
          dateTime: analysisResult.followUpDateTime || undefined,
          reason: 'call_analysis',
        })
      }

      if (analysisResult.appointmentDateTime) {
        const { randomUUID } = await import('crypto')
        manifest.pipeline.appointment = {
          appointmentId: randomUUID(),
          type: (analysisResult.appointmentType as 'phone_call' | 'in_person' | 'google_meet') || 'phone_call',
          scheduledAt: analysisResult.appointmentDateTime,
          createdAt: now,
          status: 'scheduled',
          confirmationCount: 0,
          lastSellerResponse: null,
          ghostRiskScore: 0,
          ghostProtocolActive: false,
          automationLog: [],
          assignedTo: 'casey',
          address: null,
          notes: 'Extracted from Mojo call analysis',
        }
      }

      queueBriefingRegeneration(manifest)

      if (analysisResult.opportunity_score !== undefined && analysisResult.opportunity_score !== null) {
        const aiScore = analysisResult.opportunity_score
        const aiCls: ManifestScoring['classification'] = analysisResult.classification
          || (aiScore >= 75 ? 'opportunity' : aiScore >= 40 ? 'lead' : 'dead')
        manifest.scoring = {
          opportunity_score: aiScore,
          classification: aiCls,
          reasoning: analysisResult.opportunity_reasoning || '',
          worth_enriching: analysisResult.worth_enriching ?? (aiScore >= 60),
          scored_at: new Date().toISOString(),
          scored_by: 'ai',
        }
      }
    }

    manifest.auditTrail.push({
      timestamp: now,
      agent: 'system:mojo-sync-phase2',
      action: 'call_analyzed',
      details: {
        mojoRecordId: call.record_id,
        hasRecording: !!audioPath,
        hasTranscript: !!transcriptText,
        hasAnalysis: !!analysisResult,
        motivationScore: analysisResult?.motivationScore,
        sentiment: analysisResult?.sentiment,
      },
    })

    return manifest
  } catch (err) {
    console.error('Error processing Phase 2 intelligence:', err)

    manifest.auditTrail.push({
      timestamp: now,
      agent: 'system:mojo-sync-phase2',
      action: 'phase2_error',
      details: {
        mojoRecordId: call.record_id,
        error: err instanceof Error ? err.message : String(err),
      },
    })

    return manifest
  }
}

/**
 * Full pipeline processing for a single call.
 * Called by the queue worker (process-mojo-queue) after the call has been
 * inserted into mojo_call_queue. All the heavy work — manifest find/create,
 * enrichment, AI analysis, scoring, alerts — lives here.
 */
export async function processQueuedCall(call: MojoCallRecord, queueItemId: string): Promise<{
  leadId: string | null
  manifestId: string | null
  opportunityScore: number | null
}> {
  // A. Duplicate check — look for mojoRecordId in auditTrail
  const { data: existingManifests } = await supabase
    .from('manifests')
    .select('id')
    .ilike('manifest', `%${call.record_id}%`)
    .limit(1)

  if (existingManifests && existingManifests.length > 0) {
    console.log(`[queue] Call ${call.record_id} already in manifests — skipping`)
    return { leadId: null, manifestId: null, opportunityScore: null }
  }

  // B. Find or create manifest
  const hasPhone = !!(call.phone_number && call.phone_number.trim())
  const normalizedPhone = hasPhone ? normalizePhone(call.phone_number) : ''

  let manifestId: string | null = null
  let manifest: ManifestV2 | null = null
  let leadId: string | null = null

  if (hasPhone) {
    const { data: phoneManifests } = await supabase
      .from('manifests')
      .select('id, manifest, lead_id')
      .contains('manifest->owner->phones', [normalizedPhone])
      .limit(1)

    if (phoneManifests && phoneManifests.length > 0) {
      manifestId = phoneManifests[0].id
      manifest = phoneManifests[0].manifest as ManifestV2
      leadId = phoneManifests[0].lead_id
    } else {
      const { data: phoneLeads } = await supabase
        .from('leads')
        .select('id, phone')
        .eq('phone', normalizedPhone)
        .limit(1)

      if (phoneLeads && phoneLeads.length > 0) {
        leadId = phoneLeads[0].id

        const { data: leadManifests } = await supabase
          .from('manifests')
          .select('id, manifest')
          .eq('lead_id', leadId)
          .limit(1)

        if (leadManifests && leadManifests.length > 0) {
          manifestId = leadManifests[0].id
          manifest = leadManifests[0].manifest as ManifestV2
        }
      }
    }
  }

  // Fallback: match by name if no phone
  if (!manifestId && !hasPhone && call.contact_name && call.contact_name.trim()) {
    const trimmedName = call.contact_name.trim()

    const { data: nameLeads } = await supabase
      .from('leads')
      .select('id')
      .ilike('full_name', trimmedName)
      .limit(1)

    if (nameLeads && nameLeads.length > 0) {
      leadId = nameLeads[0].id

      const { data: leadManifests } = await supabase
        .from('manifests')
        .select('id, manifest')
        .eq('lead_id', leadId)
        .limit(1)

      if (leadManifests && leadManifests.length > 0) {
        manifestId = leadManifests[0].id
        manifest = leadManifests[0].manifest as ManifestV2
      }
    }
  }

  // C. Disposition mapping
  const dispositionMap = mapDisposition(call.disposition)

  // D. Manifest update or create
  const { firstName, lastName } = parseContactName(call.contact_name)
  const now = new Date().toISOString()

  if (manifest && manifestId) {
    // Update existing manifest
    const phones = manifest.owner.phones || []
    if (hasPhone && normalizedPhone && !phones.includes(normalizedPhone)) {
      phones.push(normalizedPhone)
    }
    manifest.owner.phones = phones

    if (call.property_address) {
      manifest.property.address = call.property_address
    }

    if (dispositionMap.priority && !dispositionMap.isDead) {
      manifest.priority = dispositionMap.priority
    } else if (dispositionMap.isDead) {
      manifest.priority = 'cold'
    }

    const contact: ManifestContact = {
      name: call.agent_name,
      role: 'agent',
      phone: call.phone_number,
      notes: `${call.disposition}${call.notes ? ` — ${call.notes}` : ''}\nDuration: ${call.call_duration}s\nDate: ${call.call_date}`,
    }
    manifest.contacts.push(contact)

    if (call.notes) {
      manifest.notes.push({
        timestamp: call.call_date,
        author: call.agent_name,
        content: call.notes,
        type: 'general',
      })
    }

    if (dispositionMap.flag) {
      manifest.flags.redFlags = manifest.flags.redFlags || []
      if (!manifest.flags.redFlags.includes(dispositionMap.flag)) {
        manifest.flags.redFlags.push(dispositionMap.flag)
      }
    }

    manifest.auditTrail.push({
      timestamp: now,
      agent: 'system:mojo-sync',
      action: 'mojo_call_synced',
      details: {
        mojoRecordId: call.record_id,
        disposition: call.disposition,
        outcome: dispositionMap.outcome,
        listName: call.list_name,
        campaign: call.campaign_name,
        callDuration: call.call_duration,
        callDate: call.call_date,
      },
    })

    manifest.lastUpdated = now
    manifest.lastUpdatedBy = 'system:mojo-sync'

    await supabase
      .from('manifests')
      .update({
        manifest,
        priority: manifest.priority,
        current_station: manifest.currentStation,
      })
      .eq('id', manifestId)
  } else {
    // Guard: only create NEW leads for meaningful dispositions
    const meaningfulOutcomes = new Set([
      'callback_scheduled', 'meaningful_conversation', 'appointment_set',
    ])
    if (!meaningfulOutcomes.has(dispositionMap.outcome)) {
      console.log(`[queue] Skipping non-meaningful disposition for unknown contact: ${call.disposition}`)
      return { leadId: null, manifestId: null, opportunityScore: null }
    }

    // Create new manifest
    const manifestInput = {
      firstName,
      lastName,
      phone: hasPhone ? normalizedPhone : '',
      propertyAddress: call.property_address,
      propertyCity: call.city,
      propertyState: call.state,
      propertyZip: call.zip,
      source: 'mojo_call',
      station: call.property_address ? 'qualifying' : 'intake',
      priority: dispositionMap.isDead ? 'cold' : (dispositionMap.priority || 'warm'),
    }

    manifest = buildManifest(manifestInput)
    manifest.property.address = call.property_address
    manifest.currentStation = call.property_address ? 'qualifying' : 'intake'
    manifest.priority = dispositionMap.isDead ? 'cold' : (dispositionMap.priority || 'warm')

    const contact: ManifestContact = {
      name: call.agent_name,
      role: 'agent',
      phone: call.phone_number,
      notes: `${call.disposition}${call.notes ? ` — ${call.notes}` : ''}\nDuration: ${call.call_duration}s\nDate: ${call.call_date}`,
    }
    manifest.contacts.push(contact)

    if (call.notes) {
      manifest.notes.push({
        timestamp: call.call_date,
        author: call.agent_name,
        content: call.notes,
        type: 'general',
      })
    }

    if (dispositionMap.flag) {
      manifest.flags.redFlags = manifest.flags.redFlags || []
      manifest.flags.redFlags.push(dispositionMap.flag)
    }

    manifest.auditTrail.push({
      timestamp: now,
      agent: 'system:mojo-sync',
      action: 'mojo_call_synced',
      details: {
        mojoRecordId: call.record_id,
        disposition: call.disposition,
        outcome: dispositionMap.outcome,
        listName: call.list_name,
        campaign: call.campaign_name,
        callDuration: call.call_duration,
        callDate: call.call_date,
      },
    })

    // Create lead if needed
    if (!leadId) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          full_name: call.contact_name,
          property_address: call.property_address,
          phone: hasPhone ? normalizedPhone : null,
          email: call.email || null,
          city: call.city,
          state: call.state,
          zip: call.zip,
          source: 'mojo_call',
          station: call.property_address ? 'qualifying' : 'intake',
          priority: 'normal',
          appointment_date: call.follow_up_date || null,
        })
        .select('id')
        .single()

      if (newLead) {
        leadId = newLead.id
      }
    }

    // Insert manifest — merge if auto-created for this lead
    const { data: existingForLead } = await supabase
      .from('manifests')
      .select('id, manifest')
      .eq('lead_id', leadId)
      .limit(1)

    if (existingForLead && existingForLead.length > 0) {
      const existing = existingForLead[0]
      const merged = { ...existing.manifest, ...manifest }
      merged.auditTrail = [
        ...(existing.manifest.auditTrail || []),
        ...(manifest.auditTrail || []).filter((e: any) => e.action !== 'manifest_created'),
      ]
      await supabase
        .from('manifests')
        .update({ manifest: merged, current_station: manifest.currentStation, priority: manifest.priority })
        .eq('id', existing.id)
      manifestId = existing.id
      manifest = merged
      console.log(`[queue] Merged into existing manifest ${manifestId}`)
    } else {
      const { data } = await supabase
        .from('manifests')
        .insert({
          lead_id: leadId,
          version: manifest.version,
          manifest,
          current_station: manifest.currentStation,
          priority: manifest.priority,
        })
        .select('id')
        .single()

      if (data) {
        manifestId = data.id
      }
    }
  }

  // E. Phase 2: Process intelligence (recording → transcription → analysis)
  if (manifest && manifestId) {
    manifest.scoring = undefined

    console.log(`[queue] PRE-Phase2: agentNotes=${manifest.agentNotes?.length}, timeline=${!!manifest.situation?.timeline}`)
    manifest = await processPhase2Intelligence(call, manifest, manifestId)
    console.log(`[queue] POST-Phase2: auditTrail=${manifest.auditTrail?.length}, scoring=${!!manifest.scoring}`)

    // F. Scoring gate — AI analysis (primary) → notes → static disposition fallback
    if (!manifest.scoring) {
      const hasNotes = !!(call.notes && call.notes.trim())
      if (hasNotes) {
        const { score, reasoning } = scoreFromNotes(call, manifest)
        const cls: ManifestScoring['classification'] = score >= 75 ? 'opportunity' : score >= 40 ? 'lead' : 'dead'
        manifest.scoring = {
          opportunity_score: score,
          classification: cls,
          reasoning,
          worth_enriching: score >= 60,
          scored_at: new Date().toISOString(),
          scored_by: 'notes',
        }
      } else {
        const staticScore = dispositionMap.isDead ? 0
          : dispositionMap.outcome === 'appointment_set' ? 85
          : dispositionMap.outcome === 'meaningful_conversation' ? 65
          : dispositionMap.outcome === 'callback_scheduled' ? 45
          : 20
        const cls: ManifestScoring['classification'] = staticScore >= 75 ? 'opportunity' : staticScore >= 40 ? 'lead' : 'dead'
        manifest.scoring = {
          opportunity_score: staticScore,
          classification: cls,
          reasoning: `Static disposition mapping: ${call.disposition}`,
          worth_enriching: staticScore >= 60,
          scored_at: new Date().toISOString(),
          scored_by: 'disposition',
        }
      }
    }

    const opportunityScore = manifest.scoring.opportunity_score
    const shouldEnrich = manifest.scoring.worth_enriching
    const shouldAlert = opportunityScore >= 75
    manifest.priority = opportunityScore >= 75 ? 'hot' : opportunityScore >= 40 ? 'warm' : 'cold'

    console.log(`[queue] SCORING: score=${opportunityScore} class=${manifest.scoring.classification} shouldEnrich=${shouldEnrich} shouldAlert=${shouldAlert} by=${manifest.scoring.scored_by}`)

    // G. Enrichment — only if score >= 60
    if (shouldEnrich && call.property_address && call.state) {
      try {
        const detected = detectCounty(call.city, call.state, call.zip)
        if (detected) {
          manifest = await enrichManifestProperty(
            manifest,
            call.property_address,
            call.city,
            call.state,
            call.zip,
            detected.county
          )
          const { score: qualScore, tier } = scoreManifest(manifest)
          manifest.qualificationScore = qualScore
          manifest.tier = tier as ManifestV2['tier']

          if (leadId) {
            const prop = manifest.property || {}
            const dwell = prop.dwelling || {}
            const assess = prop.assessment || {}
            const enrichLeadUpdates: Record<string, any> = {}
            if (dwell.bedrooms) enrichLeadUpdates.beds = dwell.bedrooms
            if (dwell.bathrooms) enrichLeadUpdates.baths_full = dwell.bathrooms
            if (dwell.sqft) enrichLeadUpdates.sqft = dwell.sqft
            if (dwell.yearBuilt) enrichLeadUpdates.year_built = dwell.yearBuilt
            if (assess.appraisedTotal) enrichLeadUpdates.arv = assess.appraisedTotal
            if (assess.assessedTotal) enrichLeadUpdates.assessed_value = assess.assessedTotal
            if (dwell.propertyType) {
              enrichLeadUpdates.property_type =
                dwell.propertyType === 'SF' ? 'Single Family' : dwell.propertyType
            }
            if (dwell.basement) enrichLeadUpdates.basement_type = dwell.basement
            if (detected.county) {
              enrichLeadUpdates.data_source = `${detected.county.toLowerCase()}_county_assessor`
              enrichLeadUpdates.data_enriched_at = new Date().toISOString()
            }
            if (Object.keys(enrichLeadUpdates).length > 0) {
              await supabase.from('leads').update(enrichLeadUpdates).eq('id', leadId)
            }
          }
        }
      } catch (enrichErr) {
        console.error('[queue] Enrichment failed for call:', call.record_id, enrichErr)
      }
    }

    // H. Save manifest
    const { error: updateErr } = await supabase
      .from('manifests')
      .update({
        manifest,
        priority: manifest.priority,
        current_station: manifest.currentStation,
        qualification_score: manifest.qualificationScore ?? null,
        tier: manifest.tier ?? null,
      })
      .eq('id', manifestId)

    if (updateErr) {
      console.error(`[queue] MANIFEST UPDATE FAILED:`, updateErr.message)
    } else {
      console.log(`[queue] Manifest ${manifestId} saved successfully`)
    }

    // I. Backfill lead from manifest data
    if (leadId) {
      const leadBackfill: Record<string, any> = {}
      const currentLead = await supabase.from('leads').select('full_name, phone, property_address').eq('id', leadId).single()
      const ld = currentLead?.data

      const manifestName = manifest.owner?.fullName
      const shouldBackfillName = !ld?.full_name
        || ld.full_name === 'Unknown'
        || ld.full_name === 'Mojo Lead'
        || ld.full_name === ''
        || ld.full_name.startsWith('Caller (')
      if (manifestName && shouldBackfillName) {
        leadBackfill.full_name = manifestName
      }
      if (!ld?.phone && manifest.owner?.phones?.length > 0) {
        leadBackfill.phone = manifest.owner.phones[0]
      }
      if (!ld?.property_address && manifest.property?.address) {
        leadBackfill.property_address = manifest.property.address
      }
      if (manifest.priority && manifest.priority !== 'cold') {
        leadBackfill.priority = manifest.priority
      }
      if (Object.keys(leadBackfill).length > 0) {
        await supabase.from('leads').update(leadBackfill).eq('id', leadId)
      }
    }

    // J. Alert — only if score >= 75
    if (shouldAlert) {
      await sendAlert(
        call.contact_name,
        call.property_address,
        call.disposition,
        manifest.scoring?.opportunity_score
      )
    }

    return { leadId, manifestId, opportunityScore }
  }

  return { leadId, manifestId, opportunityScore: null }
}

/**
 * POST /api/mojo/sync
 *
 * Validates payload, deduplicates against the queue table,
 * and inserts pending items. Returns immediately (<200ms).
 * All processing is handled by the cron worker at
 * /api/cron/process-mojo-queue.
 */
export async function POST(req: NextRequest) {
  try {
    const { calls } = await req.json() as { calls: MojoCallRecord[] }

    if (!Array.isArray(calls) || calls.length === 0) {
      return NextResponse.json({ error: 'calls array required' }, { status: 400 })
    }

    let queued = 0
    let skipped = 0

    for (const call of calls) {
      if (!call.record_id) {
        skipped++
        continue
      }

      // Duplicate check against queue table (fast — indexed on record_id)
      const { data: existing } = await supabase
        .from('mojo_call_queue')
        .select('id')
        .eq('record_id', call.record_id)
        .limit(1)

      if (existing && existing.length > 0) {
        skipped++
        continue
      }

      const { error: insertErr } = await supabase
        .from('mojo_call_queue')
        .insert({
          record_id: call.record_id,
          payload: call,
          status: 'pending',
        })

      if (insertErr) {
        // UNIQUE violation means race condition — another request already inserted it
        if (insertErr.code === '23505') {
          skipped++
        } else {
          console.error(`[mojo/sync] Failed to queue call ${call.record_id}:`, insertErr.message)
          skipped++
        }
      } else {
        queued++
      }
    }

    return NextResponse.json({ queued, skipped, total: calls.length })
  } catch (err) {
    console.error('[mojo/sync] Queue insertion error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
