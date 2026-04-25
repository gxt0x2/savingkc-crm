import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { downloadRecording } from '@/lib/mojo-recording-downloader'
import { transcribeAudio } from '@/lib/mojo-transcriber'
import { analyzeCallTranscript } from '@/lib/mojo-call-analyzer'
import { supabase } from '@/lib/supabase-lazy'

// WebRTC-initiated calls record against the parent leg whose To/From are
// client identifiers rather than the dialed number. When the lookup-by-phone
// falls through, we ask Twilio for the child legs and match on their `to`.
async function resolveLeadIdFromChildLegs(callSid: string): Promise<string | null> {
  const acct = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const apiKey = process.env.TWILIO_API_KEY
  const apiSecret = process.env.TWILIO_API_SECRET
  if (!acct) return null
  let client: ReturnType<typeof twilio> | null = null
  if (apiKey && apiSecret) {
    client = twilio(apiKey, apiSecret, { accountSid: acct })
  } else if (authToken) {
    client = twilio(acct, authToken)
  }
  if (!client) return null
  try {
    const children = await client.calls.list({ parentCallSid: callSid, limit: 5 })
    for (const child of children) {
      if (!child.to) continue
      const phone = child.to.replace(/[^\d+]/g, '')
      if (!phone) continue
      const { data } = await supabase.from('leads').select('id').eq('phone', phone).limit(1).maybeSingle()
      if (data?.id) return data.id
    }
  } catch (err) {
    console.error('[recording-callback] child-leg lookup failed', (err as Error).message)
  }
  return null
}

/**
 * Twilio recording status callback.
 * Called automatically when a call recording is ready.
 * Downloads → transcribes → analyzes → stores in manifest.
 */
export async function POST(req: Request) {
  try {
    const body = await req.formData()
    const recordingUrl = body.get('RecordingUrl') as string
    const recordingSid = body.get('RecordingSid') as string
    const callSid = body.get('CallSid') as string
    const recordingDuration = parseInt(body.get('RecordingDuration') as string || '0')
    const recordingStatus = body.get('RecordingStatus') as string

    console.log(`[recording-callback] Recording ${recordingSid}: status=${recordingStatus} duration=${recordingDuration}s`)

    // Only process completed recordings
    if (recordingStatus !== 'completed' || !recordingUrl) {
      return NextResponse.json({ ok: true, skipped: 'not_completed' })
    }

    // Skip very short recordings (< 5 seconds = likely no conversation)
    if (recordingDuration < 5) {
      console.log(`[recording-callback] Skipping short recording (${recordingDuration}s)`)
      return NextResponse.json({ ok: true, skipped: 'too_short' })
    }

    // Find the lead associated with this call via recent call activities
    const { data: recentActivity } = await supabase
      .from('lead_activities')
      .select('lead_id, metadata')
      .eq('activity_type', 'call')
      .order('created_at', { ascending: false })
      .limit(20)

    // Match by looking for the phone number in recent call activities
    // Twilio sends the call's To/From in separate params
    const to = body.get('To') as string
    const from = body.get('From') as string
    const callerPhone = from?.startsWith('client:') ? to : from
    const cleanPhone = callerPhone?.replace(/[^\d+]/g, '') || ''

    let leadId: string | null = null

    // Try to match via phone number in leads table
    if (cleanPhone) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', cleanPhone)
        .limit(1)
        .maybeSingle()
      leadId = lead?.id || null
    }

    // Fallback: WebRTC parent legs have empty To — look at child legs via Twilio
    if (!leadId && callSid) {
      leadId = await resolveLeadIdFromChildLegs(callSid)
      if (leadId) {
        console.log(`[recording-callback] Resolved lead ${leadId} via child-leg lookup`)
      }
    }

    if (!leadId) {
      console.log(`[recording-callback] No lead found (phone=${cleanPhone || 'none'} callSid=${callSid}), skipping transcript`)
      return NextResponse.json({ ok: true, skipped: 'no_lead' })
    }

    console.log(`[recording-callback] Processing recording for lead ${leadId}`)

    // Fire-and-forget: download, transcribe, analyze, store
    processRecording(recordingUrl, recordingSid, leadId, recordingDuration).catch(err =>
      console.error('[recording-callback] Processing failed:', err)
    )

    return NextResponse.json({ ok: true, leadId, processing: true })
  } catch (err) {
    console.error('[recording-callback] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

async function processRecording(
  recordingUrl: string,
  recordingSid: string,
  leadId: string,
  duration: number
) {
  // 1. Download recording
  const filePath = await downloadRecording(recordingUrl, recordingSid)

  // 2. Transcribe with Groq Whisper
  const transcript = await transcribeAudio(filePath)

  if (!transcript || transcript.length < 10) {
    console.log(`[recording-callback] Transcript too short, skipping analysis`)
    return
  }

  console.log(`[recording-callback] Transcript (${transcript.length} chars): ${transcript.slice(0, 100)}...`)

  // 3. Save transcript to lead_activities
  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'note',
    description: `Call transcript: ${transcript.slice(0, 500)}${transcript.length > 500 ? '...' : ''}`,
    agent: 'AI',
    metadata: {
      source: 'whisper_transcription',
      recordingSid,
      fullTranscript: transcript,
      duration,
    },
  })

  // 4. Analyze transcript with AI
  const analysis = await analyzeCallTranscript(transcript)

  // 5. Save analysis to lead_activities
  if (analysis) {
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'note',
      description: `AI Call Analysis: ${analysis.aiSummary || analysis.summary || 'Analysis complete'}`,
      agent: 'AI',
      metadata: { source: 'call_analysis', analysis },
    })

    // 6. Update lead fields from analysis (+ denormalized last-call snapshot)
    const leadUpdates: Record<string, any> = {
      transcript,
      call_duration_seconds: duration,
      updated_at: new Date().toISOString(),
    }
    if (analysis.motivationScore) leadUpdates.motivation_score = analysis.motivationScore
    if (analysis.conditionOverall) leadUpdates.property_condition = analysis.conditionOverall
    if (analysis.sellerAsking) leadUpdates.asking_price = analysis.sellerAsking
    if (typeof analysis.opportunity_score === 'number') leadUpdates.opportunity_score = analysis.opportunity_score
    if (analysis.classification) leadUpdates.classification = analysis.classification

    // Promote AI-extracted appointment to the relational lead row so the lead
    // page, next-action engine, and any future appointments dashboard read
    // from one source of truth instead of digging through manifest JSON.
    if (analysis.appointmentDateTime) {
      leadUpdates.appointment_date = analysis.appointmentDateTime
      const apptType = analysis.appointmentType ? `${analysis.appointmentType} appointment` : 'Appointment'
      const summary = analysis.aiSummary || analysis.summary || analysis.followUpAction || ''
      leadUpdates.appointment_notes = summary ? `${apptType} — ${summary}` : apptType
    }

    await supabase.from('leads').update(leadUpdates).eq('id', leadId)
  } else {
    // No analysis available but still refresh the transcript + duration
    await supabase.from('leads').update({
      transcript,
      call_duration_seconds: duration,
      updated_at: new Date().toISOString(),
    }).eq('id', leadId)
  }

  // 7. Update manifest with transcript + analysis
  try {
    const { updateManifestAndCascade } = await import('@/lib/manifest-sync')
    await updateManifestAndCascade(leadId, (manifest: any) => {
      // Store transcript
      if (!manifest.communications) manifest.communications = { transcripts: [] }
      manifest.communications.transcripts.push({
        id: `call-${recordingSid}`,
        date: new Date().toISOString(),
        duration,
        agent: 'Casey',
        recordingUrl: recordingUrl + '.mp3',
        fullTranscript: transcript,
        aiSummary: analysis?.summary || analysis?.aiSummary || null,
        extractedData: analysis ? {
          motivationScore: analysis.motivationScore,
          sentiment: analysis.sentiment,
          rapportLevel: analysis.rapportLevel,
          verbatimQuotes: analysis.verbatimQuotes,
          // Feed the Pain Points component: pull from keyLeverage + emotionalDrivers
          painPoints: [
            ...(analysis.keyLeverage || []),
            ...(analysis.emotionalDrivers || []),
          ].filter(Boolean),
        } : null,
      })

      // Apply seller intelligence from analysis
      if (analysis) {
        if (analysis.personalityType) {
          if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
          if (!manifest.ariIntelligence.sellerProfile) manifest.ariIntelligence.sellerProfile = {}
          manifest.ariIntelligence.sellerProfile.personalityType = analysis.personalityType
        }
        if (analysis.communicationStyle) {
          if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
          if (!manifest.ariIntelligence.sellerProfile) manifest.ariIntelligence.sellerProfile = {}
          manifest.ariIntelligence.sellerProfile.communicationStyle = analysis.communicationStyle
        }
        if (analysis.keyLeverage?.length) {
          if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
          if (!manifest.ariIntelligence.dealIntelligence) manifest.ariIntelligence.dealIntelligence = {}
          manifest.ariIntelligence.dealIntelligence.keyLeverage = analysis.keyLeverage
        }
        if (analysis.objectionsRaised?.length) {
          if (!manifest.situation.objections) manifest.situation.objections = []
          for (const obj of analysis.objectionsRaised) {
            if (!manifest.situation.objections.includes(obj)) {
              manifest.situation.objections.push(obj)
            }
          }
        }
        if (analysis.outOfState) manifest.owner.outOfState = true
        if (analysis.vacant) {
          if (!manifest.situation.type) manifest.situation.type = []
          if (!manifest.situation.type.includes('vacant')) manifest.situation.type.push('vacant')
        }
        if (analysis.coOwners?.length) {
          manifest.owner.coOwners = analysis.coOwners
        }

        // ── Structured situation fields consumed by SellerGoals, PainPoints,
        //    FavoriteOrFool. These were missing, so those UI cards never
        //    reflected a new conversation even when transcription succeeded.
        if (!manifest.situation) manifest.situation = {}
        if (!manifest.situation.motivation) manifest.situation.motivation = {}
        if (!manifest.situation.timeline) manifest.situation.timeline = {}
        if (!manifest.situation.priceExpectations) manifest.situation.priceExpectations = {}

        if (analysis.urgency) manifest.situation.motivation.urgencyLevel = analysis.urgency
        if (analysis.motivationScore) manifest.situation.motivation.score = analysis.motivationScore
        if (analysis.motivationSignals?.length) {
          const existing: string[] = manifest.situation.motivation.signals || []
          for (const s of analysis.motivationSignals) {
            if (!existing.includes(s)) existing.push(s)
          }
          manifest.situation.motivation.signals = existing
        }
        if (analysis.emotionalDrivers?.length) {
          manifest.situation.motivation.emotionalDrivers = analysis.emotionalDrivers
          if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
          if (!manifest.ariIntelligence.sellerProfile) manifest.ariIntelligence.sellerProfile = {}
          manifest.ariIntelligence.sellerProfile.emotionalDrivers = analysis.emotionalDrivers
        }

        if (analysis.targetCloseDate) manifest.situation.timeline.preferredClosing = analysis.targetCloseDate
        if (analysis.hardDeadline !== undefined) manifest.situation.timeline.hardDeadline = analysis.hardDeadline
        if (analysis.deadlineReason) manifest.situation.timeline.deadlineReason = analysis.deadlineReason
        if (analysis.urgency) {
          manifest.situation.timeline.flexibility =
            analysis.urgency === 'critical' || analysis.urgency === 'high' ? 'tight' :
            analysis.urgency === 'medium' ? 'moderate' : 'flexible'
        }

        if (analysis.sellerAsking != null) manifest.situation.priceExpectations.sellerAsking = analysis.sellerAsking
        if (analysis.sellerFloor != null) manifest.situation.priceExpectations.sellerFloor = analysis.sellerFloor
        if (analysis.priceFlexibility) manifest.situation.priceExpectations.flexibility = analysis.priceFlexibility
        if (analysis.priceAnchor) manifest.situation.priceExpectations.anchor = analysis.priceAnchor

        if (!manifest.property) manifest.property = {}
        if (!manifest.property.condition) manifest.property.condition = {}
        if (analysis.conditionOverall) manifest.property.condition.overall = analysis.conditionOverall
        if (analysis.repairsNotes) manifest.property.condition.repairsNotes = analysis.repairsNotes
        if (analysis.vacant === true) manifest.property.vacant = true

        if (analysis.situationType?.length) {
          if (!manifest.situation.type) manifest.situation.type = []
          for (const t of analysis.situationType) {
            if (!manifest.situation.type.includes(t)) manifest.situation.type.push(t)
          }
        }
        if (analysis.blockers?.length) {
          if (!manifest.situation.blockers) manifest.situation.blockers = []
          for (const b of analysis.blockers) {
            if (!manifest.situation.blockers.includes(b)) manifest.situation.blockers.push(b)
          }
        }

        if (analysis.dealConfidenceScore != null) {
          if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
          if (!manifest.ariIntelligence.dealIntelligence) manifest.ariIntelligence.dealIntelligence = {}
          manifest.ariIntelligence.dealIntelligence.confidenceScore = analysis.dealConfidenceScore
        }
        if (analysis.followUpAction) {
          if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
          if (!manifest.ariIntelligence.recommendedActions) manifest.ariIntelligence.recommendedActions = []
          manifest.ariIntelligence.recommendedActions.unshift({
            action: analysis.followUpAction,
            reason: 'transcript_analysis',
            when: analysis.followUpDateTime || null,
          })
        }

        // Mirror of mojo/sync: when the analyzer extracts a concrete
        // appointment, write it as the canonical pipeline.appointment so
        // the lead page, NextAction, and ghost-protocol all see a single
        // structured record instead of guessing from prose.
        if (analysis.appointmentDateTime) {
          const { randomUUID } = await import('crypto')
          manifest.pipeline = manifest.pipeline || {}
          manifest.pipeline.appointment = {
            appointmentId: randomUUID(),
            type: (analysis.appointmentType as 'phone_call' | 'in_person' | 'google_meet') || 'phone_call',
            scheduledAt: analysis.appointmentDateTime,
            createdAt: new Date().toISOString(),
            status: 'scheduled',
            confirmationCount: 0,
            lastSellerResponse: null,
            ghostRiskScore: 0,
            ghostProtocolActive: false,
            automationLog: [],
            assignedTo: 'casey',
            address: null,
            notes: analysis.aiSummary || analysis.summary || analysis.followUpAction || 'Extracted from CRM call transcript',
          }
        }
      }

      // Mark briefing stale
      if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
      manifest.ariIntelligence.briefingStale = true

      // Audit trail
      if (!manifest.auditTrail) manifest.auditTrail = []
      manifest.auditTrail.push({
        timestamp: new Date().toISOString(),
        agent: 'system:recording_callback',
        action: 'transcript_added',
        details: {
          recordingSid,
          duration,
          transcriptLength: transcript.length,
          hasAnalysis: !!analysis,
        },
      })
    }, 'system:recording_callback')

    // Eager briefing regen — transcript is high-value intelligence
    const { regenerateBriefing } = await import('@/lib/briefing-regen')
    await regenerateBriefing(leadId, 'transcript_added').catch(() => {})
  } catch (err) {
    console.error('[recording-callback] Manifest update failed:', err)
  }

  console.log(`[recording-callback] Recording processed for lead ${leadId}: transcript=${transcript.length} chars, analysis=${!!analysis}`)
}
