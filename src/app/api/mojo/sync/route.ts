import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildManifest } from '@/lib/manifest-builder'
import { detectCounty } from '@/lib/county-enrichment'
import { enrichManifestProperty, scoreManifest } from '@/lib/manifest-enrichment'
import type { ManifestV2, ManifestContact, TranscriptEntry, ManifestAgentNote, ManifestOwner, ManifestProperty, ManifestSituation } from '@/lib/manifest-builder'
import { downloadRecording } from '@/lib/mojo-recording-downloader'
import { transcribeAudio } from '@/lib/mojo-transcriber'
import { analyzeCallTranscript, type CallAnalysisResult } from '@/lib/mojo-call-analyzer'
import { safeSendSMS } from '@/lib/safe-communications'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface MojoCallRecord {
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

      // === Extract structured seller intel from Casey's notes ===
      // Casey writes: "Timeline: ...\nCondition: ...\nPrice: ...\nMotivation: ..."
      const notes = call.notes
      const timelineMatch = notes.match(/Timeline:\s*(.+?)(?:\n|$)/i)
      const conditionMatch = notes.match(/Condition:\s*(.+?)(?:\n|$)/i)
      const priceMatch = notes.match(/Price:\s*(.+?)(?:\n|$)/i)
      const motivationMatch = notes.match(/Motivation:\s*(.+?)(?:\n|$)/i)

      if (timelineMatch || conditionMatch || priceMatch || motivationMatch) {
        console.log(`[mojo/sync] Extracting seller intel from agent notes for ${call.contact_name}`)

        if (timelineMatch) {
          if (!manifest.situation.timeline) manifest.situation.timeline = {}
          ;(manifest.situation.timeline as any).notes = timelineMatch[1].trim()
          // Detect urgency from keywords
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
          // Extract dollar amounts
          const amounts = priceMatch[1].match(/\$?([\d,]+)k?/gi)
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

        // Add audit trail entry for note intel extraction
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

    // Step 5: Update manifest fields from analysis (respecting write priority rules)
    if (analysisResult) {
      // Owner fields
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
      // Normalize and add alternate phones
      if (analysisResult.alternatePhonesFound && analysisResult.alternatePhonesFound.length > 0) {
        for (const phone of analysisResult.alternatePhonesFound) {
          const normalized = normalizePhone(phone)
          if (!manifest.owner.phones.includes(normalized)) {
            manifest.owner.phones.push(normalized)
          }
        }
      }

      // Property fields
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

      // Situation fields
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

      // Ari Intelligence fields
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

      // Recommended actions
      if (analysisResult.followUpAction) {
        if (!manifest.ariIntelligence.recommendedActions) manifest.ariIntelligence.recommendedActions = []
        manifest.ariIntelligence.recommendedActions.push({
          action: analysisResult.followUpAction,
          dateTime: analysisResult.followUpDateTime || undefined,
          reason: 'call_analysis',
        })
      }

      // Pipeline appointment
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

      // Queue briefing regeneration
      queueBriefingRegeneration(manifest)
    }

    // Add audit entry
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

    // Log error to audit trail
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

export async function POST(req: NextRequest) {
  try {
    const { calls } = await req.json() as { calls: MojoCallRecord[] }

    if (!Array.isArray(calls) || calls.length === 0) {
      return NextResponse.json({ error: 'calls array required' }, { status: 400 })
    }

    // Log raw incoming data for debugging
    console.log(`[mojo/sync] Received ${calls.length} call(s)`)
    for (const c of calls) {
      const missing: string[] = []
      if (!c.property_address) missing.push('property_address')
      if (!c.recording_url) missing.push('recording_url')
      if (!c.city) missing.push('city')
      if (!c.state) missing.push('state')
      if (!c.zip) missing.push('zip')
      console.log(`[mojo/sync] Call ${c.record_id}: ${c.contact_name} | phone=${c.phone_number} | addr="${c.property_address || 'MISSING'}" | recording=${c.recording_url ? 'YES' : 'MISSING'} | disposition=${c.disposition}`)
      if (missing.length > 0) {
        console.warn(`[mojo/sync] ⚠️ MISSING FIELDS for ${c.contact_name}: ${missing.join(', ')}`)
      }
    }

    let processed = 0
    let created = 0
    let updated = 0
    let skipped = 0
    let alertsSent = 0

    for (const call of calls) {
      try {
        // A. Duplicate check — look for mojoRecordId in auditTrail
        // Use textSearch on the JSONB field to find the mojoRecordId
        const { data: existingManifests } = await supabase
          .from('manifests')
          .select('id')
          .ilike('manifest', `%${call.record_id}%`)
          .limit(1)

        if (existingManifests && existingManifests.length > 0) {
          skipped++
          continue
        }

        // B. Find or create manifest
        const hasPhone = !!(call.phone_number && call.phone_number.trim())
        const normalizedPhone = hasPhone ? normalizePhone(call.phone_number) : ''

        let manifestId: string | null = null
        let manifest: ManifestV2 | null = null
        let leadId: string | null = null
        let isNew = false

        if (hasPhone) {
          // Search by phone in manifests
          const { data: phoneManifests } = await supabase
            .from('manifests')
            .select('id, manifest, lead_id')
            .contains('manifest->owner->phones', [normalizedPhone])
            .limit(1)

          if (phoneManifests && phoneManifests.length > 0) {
            // Found existing manifest by phone
            manifestId = phoneManifests[0].id
            manifest = phoneManifests[0].manifest as ManifestV2
            leadId = phoneManifests[0].lead_id
          } else {
            // Search by phone in leads table
            const { data: phoneLeads } = await supabase
              .from('leads')
              .select('id, phone')
              .eq('phone', normalizedPhone)
              .limit(1)

            if (phoneLeads && phoneLeads.length > 0) {
              leadId = phoneLeads[0].id

              // Check if this lead has a manifest
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

        // Fallback: if no phone but we have a contact name, match by name
        if (!manifestId && !hasPhone && call.contact_name && call.contact_name.trim()) {
          const trimmedName = call.contact_name.trim()

          // Search leads by full_name (case-insensitive)
          const { data: nameLeads } = await supabase
            .from('leads')
            .select('id')
            .ilike('full_name', trimmedName)
            .limit(1)

          if (nameLeads && nameLeads.length > 0) {
            leadId = nameLeads[0].id

            // Check if this lead has a manifest
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
          // Add phone if not already there
          const phones = manifest.owner.phones || []
          if (hasPhone && normalizedPhone && !phones.includes(normalizedPhone)) {
            phones.push(normalizedPhone)
          }
          manifest.owner.phones = phones

          // Update property address if provided
          if (call.property_address) {
            manifest.property.address = call.property_address
          }

          // Update priority if mapped (unless it's a dead lead)
          if (dispositionMap.priority && !dispositionMap.isDead) {
            manifest.priority = dispositionMap.priority
          } else if (dispositionMap.isDead) {
            // Dead leads get marked as cold priority
            manifest.priority = 'cold'
          }

          // Add contact entry
          const contact: ManifestContact = {
            name: call.agent_name,
            role: 'agent',
            phone: call.phone_number,
            notes: `${call.disposition}${call.notes ? ` — ${call.notes}` : ''}\nDuration: ${call.call_duration}s\nDate: ${call.call_date}`,
          }
          manifest.contacts.push(contact)

          // Add note if provided
          if (call.notes) {
            manifest.notes.push({
              timestamp: call.call_date,
              author: call.agent_name,
              content: call.notes,
              type: 'general',
            })
          }

          // Add flag if mapped
          if (dispositionMap.flag) {
            manifest.flags.redFlags = manifest.flags.redFlags || []
            if (!manifest.flags.redFlags.includes(dispositionMap.flag)) {
              manifest.flags.redFlags.push(dispositionMap.flag)
            }
          }

          // Add audit entry
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

          // Update in database
          await supabase
            .from('manifests')
            .update({
              manifest,
              priority: manifest.priority,
              current_station: manifest.currentStation,
            })
            .eq('id', manifestId)

          updated++
        } else {
          // Guard: only create NEW leads for meaningful dispositions
          // No answer, voicemail, hung up, dead, not interested = skip new lead creation
          const meaningfulOutcomes = new Set([
            'callback_scheduled', 'meaningful_conversation', 'appointment_set',
          ])
          if (!meaningfulOutcomes.has(dispositionMap.outcome)) {
            // Non-meaningful call to unknown contact — skip, don't pollute the CRM
            skipped++
            continue
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
            station: call.property_address ? 'qualification' : 'intake',
            priority: dispositionMap.isDead ? 'cold' : (dispositionMap.priority || 'warm'),
          }

          manifest = buildManifest(manifestInput)

          // Override default values with Mojo data
          manifest.property.address = call.property_address
          manifest.currentStation = call.property_address ? 'qualification' : 'intake'
          manifest.priority = dispositionMap.isDead ? 'cold' : (dispositionMap.priority || 'warm')

          // Add contact entry
          const contact: ManifestContact = {
            name: call.agent_name,
            role: 'agent',
            phone: call.phone_number,
            notes: `${call.disposition}${call.notes ? ` — ${call.notes}` : ''}\nDuration: ${call.call_duration}s\nDate: ${call.call_date}`,
          }
          manifest.contacts.push(contact)

          // Add note
          if (call.notes) {
            manifest.notes.push({
              timestamp: call.call_date,
              author: call.agent_name,
              content: call.notes,
              type: 'general',
            })
          }

          // Add flag if mapped
          if (dispositionMap.flag) {
            manifest.flags.redFlags = manifest.flags.redFlags || []
            manifest.flags.redFlags.push(dispositionMap.flag)
          }

          // Add audit entry
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
                city: call.city,
                state: call.state,
                zip: call.zip,
                source: 'mojo_call',
                station: call.property_address ? 'qualification' : 'intake',
                priority: 'normal',
              })
              .select('id')
              .single()

            if (newLead) {
              leadId = newLead.id
            }
          }

          // Insert manifest
          const { data: newManifest } = await supabase
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

          if (newManifest) {
            manifestId = newManifest.id
            created++
            isNew = true
          }
        }

        // E. If new manifest with address: trigger enrichment
        if (isNew && manifest && manifestId && call.property_address && call.state) {
          try {
            const detected = detectCounty(call.city, call.state, call.zip)
            if (detected) {
              // Enrich manifest
              manifest = await enrichManifestProperty(
                manifest,
                call.property_address,
                call.city,
                call.state,
                call.zip,
                detected.county
              )

              // Score manifest
              const { score, tier } = scoreManifest(manifest)
              manifest.qualificationScore = score
              manifest.tier = tier as ManifestV2['tier']

              // Update manifest in database
              await supabase
                .from('manifests')
                .update({
                  manifest,
                  qualification_score: score,
                  tier,
                })
                .eq('id', manifestId)

              // Also update leads table
              if (leadId) {
                const prop = manifest.property || {}
                const dwell = prop.dwelling || {}
                const assess = prop.assessment || {}

                const leadUpdates: Record<string, any> = {}
                if (dwell.bedrooms) leadUpdates.beds = dwell.bedrooms
                if (dwell.bathrooms) leadUpdates.baths_full = dwell.bathrooms
                if (dwell.sqft) leadUpdates.sqft = dwell.sqft
                if (dwell.yearBuilt) leadUpdates.year_built = dwell.yearBuilt
                if (assess.appraisedTotal) leadUpdates.arv = assess.appraisedTotal
                if (assess.assessedTotal) leadUpdates.assessed_value = assess.assessedTotal
                if (dwell.propertyType) {
                  leadUpdates.property_type =
                    dwell.propertyType === 'SF' ? 'Single Family' : dwell.propertyType
                }
                if (dwell.basement) leadUpdates.basement_type = dwell.basement
                if (detected.county) {
                  leadUpdates.data_source = `${detected.county.toLowerCase()}_county_assessor`
                  leadUpdates.data_enriched_at = new Date().toISOString()
                }

                if (Object.keys(leadUpdates).length > 0) {
                  await supabase.from('leads').update(leadUpdates).eq('id', leadId)
                }
              }
            }
          } catch (enrichErr) {
            console.error('Enrichment failed for call:', call.record_id, enrichErr)
          }
        }

        // F. Phase 2: Process intelligence (recording → transcription → analysis)
        if (manifest && manifestId) {
          manifest = await processPhase2Intelligence(call, manifest, manifestId)

          // Update manifest with Phase 2 data
          await supabase
            .from('manifests')
            .update({
              manifest,
              priority: manifest.priority,
              current_station: manifest.currentStation,
            })
            .eq('id', manifestId)

          // G. Backfill lead from manifest data (fixes empty "Mojo Lead" / "Unknown" records)
          if (leadId) {
            const leadBackfill: Record<string, any> = {}
            const currentLead = await supabase.from('leads').select('full_name, phone, property_address').eq('id', leadId).single()
            const ld = currentLead?.data

            // Backfill name from manifest owner
            const manifestName = manifest.owner?.fullName
            if (manifestName && ld?.full_name && ['Unknown', 'Mojo Lead', ''].includes(ld.full_name)) {
              leadBackfill.full_name = manifestName
            }

            // Backfill phone from manifest owner phones
            if (!ld?.phone && manifest.owner?.phones?.length > 0) {
              leadBackfill.phone = manifest.owner.phones[0]
            }

            // Backfill address from manifest property
            if (!ld?.property_address && manifest.property?.address) {
              leadBackfill.property_address = manifest.property.address
            }

            // Backfill priority from manifest
            if (manifest.priority && manifest.priority !== 'cold') {
              leadBackfill.priority = manifest.priority
            }

            if (Object.keys(leadBackfill).length > 0) {
              await supabase.from('leads').update(leadBackfill).eq('id', leadId)
            }
          }
        }

        // G. Alerts
        if (dispositionMap.alertErnest) {
          const score = manifest?.qualificationScore
          const sent = await sendAlert(
            call.contact_name,
            call.property_address,
            call.disposition,
            score
          )
          if (sent) alertsSent++
        }

        processed++
      } catch (callErr) {
        console.error('Error processing call:', call.record_id, callErr)
      }
    }

    // H. Response
    return NextResponse.json({
      processed,
      created,
      updated,
      skipped,
      alerts_sent: alertsSent,
    })
  } catch (err) {
    console.error('Mojo sync error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
