import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { downloadRecording } from '@/lib/mojo-recording-downloader'
import { transcribeAudio } from '@/lib/mojo-transcriber'
import { analyzeCallTranscript } from '@/lib/mojo-call-analyzer'
import { isInternalTestPhone } from '@/lib/internal-test-phones'
import { supabase } from '@/lib/supabase-lazy'
import {
  GOOGLE_ADS_CAMPAIGN,
  GOOGLE_ADS_PHONE_SOURCE,
  GOOGLE_ADS_TAX_PHONE_SOURCE,
  getGoogleAdsPhoneProfile,
  PPC_TRACKING_PHONE_DIGITS,
  isPpcTrackingNumber,
} from '@/lib/call-quality-events'
import {
  markLeadAsGoogleAdsPhoneLead,
  phoneLookupVariants,
  resolveGoogleAdsLeadContext,
} from '@/lib/google-ads-phone'
import { resolveLeadIdFromCallActivity } from '@/lib/telephony/recording-lead-resolution'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import {
  claimPlayableRecordingActivity,
  markRecordingProcessing,
} from '@/lib/telephony/recording-processing-claim'
import {
  completeDialerPostCallReview,
  markDialerPostCallProcessing,
  markDialerPostCallUnavailable,
} from '@/lib/server/dialer-post-call-review'
import type { CallAnalysisResult } from '@/lib/mojo-call-analyzer'
import { createCallAnalysisLeadProposal } from '@/lib/server/ai-change-proposals'

export const runtime = 'nodejs'
export const maxDuration = 60

type RecordingContext = {
  source?: string
  from?: string
  to?: string
  calledNumber?: string
  traffic_source?: string
  campaign?: string
  lead_source?: string
  tracking_number?: string
  landing_page?: string
  phone_profile?: string
  is_test?: boolean
}

type JsonObject = Record<string, unknown>

type MutableManifest = JsonObject & {
  communications?: { transcripts: JsonObject[] }
  ariIntelligence?: JsonObject & { briefingStale?: boolean }
  auditTrail?: JsonObject[]
}

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
      for (const variant of phoneLookupVariants(phone)) {
        const { data } = await supabase.from('leads').select('id').eq('phone', variant).limit(1).maybeSingle()
        if (data?.id) return data.id
      }
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
    if (!(await validateTwilioWebhook(req))) {
      return NextResponse.json({ error: 'Invalid Twilio signature' }, { status: 403 })
    }

    const url = new URL(req.url)
    const body = await req.formData()
    const recordingUrl = body.get('RecordingUrl') as string
    const recordingSid = body.get('RecordingSid') as string
    const callSid = (url.searchParams.get('callSid') || body.get('CallSid')) as string
    const recordingDuration = parseInt(body.get('RecordingDuration') as string || '0')
    const recordingStatus = body.get('RecordingStatus') as string
    const to = (url.searchParams.get('calledNumber') || url.searchParams.get('to') || body.get('To') || '') as string
    const from = (url.searchParams.get('from') || body.get('From') || '') as string
    const hintedLeadId = url.searchParams.get('leadId') || ''
    const clientAttemptId = url.searchParams.get('clientAttemptId') || null
    const sourceHint = url.searchParams.get('source') || ''
    const calledNumber = url.searchParams.get('calledNumber') || to || ''
    const externalPhone = from?.startsWith('client:') ? to : from
    const isInternalTestRecording = isInternalTestPhone(externalPhone)
    const profile = getGoogleAdsPhoneProfile(sourceHint || calledNumber)
    const isFormLeadAgentCallback = sourceHint === 'ppc_form_agent_callback'
    const isGoogleAdsRecording = !isFormLeadAgentCallback && (
      sourceHint === GOOGLE_ADS_PHONE_SOURCE ||
      sourceHint === GOOGLE_ADS_TAX_PHONE_SOURCE ||
      isPpcTrackingNumber(calledNumber)
    )
    const recordingContext: RecordingContext = {
      source: sourceHint || 'twilio_recording_callback',
      from,
      to,
      calledNumber,
      is_test: isInternalTestRecording,
      ...(isGoogleAdsRecording && {
        traffic_source: 'google_ads',
        campaign: profile.campaign || GOOGLE_ADS_CAMPAIGN,
        lead_source: profile.source,
        tracking_number: profile.trackingDigits || PPC_TRACKING_PHONE_DIGITS,
        landing_page: profile.landingPage,
        phone_profile: profile.key,
      }),
    }

    console.log(`[recording-callback] Recording ${recordingSid}: status=${recordingStatus} duration=${recordingDuration}s`)

    // Only process completed recordings
    if (recordingStatus !== 'completed' || !recordingUrl) {
      return NextResponse.json({ ok: true, skipped: 'not_completed' })
    }

    if (!recordingSid) {
      return NextResponse.json({ error: 'Missing RecordingSid' }, { status: 400 })
    }

    // Skip very short recordings (< 5 seconds = likely no conversation)
    if (recordingDuration < 5) {
      console.log(`[recording-callback] Skipping short recording (${recordingDuration}s)`)
      await markDialerPostCallUnavailable({
        clientAttemptId,
        providerCallSid: callSid || null,
        recordingSid,
        status: 'skipped',
        failureCode: 'recording_too_short',
      }).catch((error) => console.error('[recording-callback] Failed to mark short review:', error))
      return NextResponse.json({ ok: true, skipped: 'too_short' })
    }

    if (isInternalTestRecording) {
      console.log(`[recording-callback] Skipping internal test phone recording (${externalPhone || 'unknown'})`)
      return NextResponse.json({ ok: true, skipped: 'internal_test_phone' })
    }

    // Match the recorded call back to a lead by the external phone number.
    const callerPhone = from?.startsWith('client:') ? to : from
    const cleanPhone = callerPhone?.replace(/[^\d+]/g, '') || ''

    let leadId: string | null = null

    if (hintedLeadId) {
      const { data: hintedLead } = await supabase
        .from('leads')
        .select('id')
        .eq('id', hintedLeadId)
        .limit(1)
        .maybeSingle()
      leadId = hintedLead?.id || null
    }

    // Try to match via phone number in leads table
    if (!leadId && cleanPhone) {
      for (const variant of phoneLookupVariants(cleanPhone)) {
        const { data: lead } = await supabase
          .from('leads')
          .select('id')
          .eq('phone', variant)
          .limit(1)
          .maybeSingle()
        leadId = lead?.id || null
        if (leadId) break
      }
    }

    // Google Ads call recordings are seller-facing signals. If no seller lead
    // exists yet, resolve/create it from the caller phone before falling back
    // to child-leg lookup, which can match the internal agent leg instead.
    if (!leadId && isGoogleAdsRecording && cleanPhone) {
      const googleAdsLead = await resolveGoogleAdsLeadContext(cleanPhone, calledNumber || sourceHint)
      leadId = googleAdsLead.leadId
      if (leadId) {
        console.log(`[recording-callback] Resolved Google Ads recording to seller lead ${leadId}`)
      }
    }

    // Prefer the CRM call event when it already resolved the lead. Falling
    // through to child legs can match an internal agent phone on inbound calls.
    if (!leadId && callSid) {
      leadId = await resolveLeadIdFromCallActivity(callSid)
      if (leadId) {
        console.log(`[recording-callback] Resolved lead ${leadId} via call activity lookup`)
      }
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
      await markDialerPostCallUnavailable({
        clientAttemptId,
        providerCallSid: callSid || null,
        recordingSid,
        failureCode: 'lead_not_resolved',
      }).catch((error) => console.error('[recording-callback] Failed to mark unresolved review:', error))
      return NextResponse.json({ ok: true, skipped: 'no_lead' })
    }

    const processingClaim = await claimPlayableRecordingActivity({
      leadId,
      recordingSid,
      recordingUrl,
      callSid,
      duration: recordingDuration,
      recordingStatus,
      from,
      to,
      context: recordingContext,
    })

    if (!processingClaim.shouldProcess) {
      console.log(`[recording-callback] Skipping ${recordingSid}: ${processingClaim.skipped}`)
      return NextResponse.json({
        ok: true,
        leadId,
        processed: false,
        skipped: processingClaim.skipped,
      })
    }

    console.log(`[recording-callback] Processing recording for lead ${leadId}`)

    try {
      await markDialerPostCallProcessing({
        clientAttemptId,
        leadId,
        providerCallSid: callSid || null,
        recordingSid,
      }).catch((stateError) => {
        console.error('[recording-callback] Failed to mark post-call review processing:', stateError)
      })
      if (isGoogleAdsRecording && from && !isInternalTestRecording) {
        await markLeadAsGoogleAdsPhoneLead(leadId, from, null, calledNumber || sourceHint).catch((error) => {
          console.error('[recording-callback] Google Ads attribution refresh failed:', error)
        })
      }

      const analysis = await processRecording(recordingUrl, recordingSid, leadId, recordingDuration, recordingContext)
      if (analysis) {
        await createCallAnalysisLeadProposal({
          leadId,
          clientAttemptId,
          recordingSid,
          analysis,
        }).catch((proposalError) => {
          console.error('[recording-callback] Failed to persist AI change proposal:', proposalError)
        })
      }
      await markRecordingProcessing(processingClaim, 'completed')
      const reviewUpdate = analysis
        ? completeDialerPostCallReview({
          clientAttemptId,
          leadId,
          providerCallSid: callSid || null,
          recordingSid,
          analysis,
        })
        : markDialerPostCallUnavailable({
          clientAttemptId,
          leadId,
          providerCallSid: callSid || null,
          recordingSid,
          status: 'skipped',
          failureCode: 'transcript_too_short',
        })
      await reviewUpdate.catch((stateError) => {
        console.error('[recording-callback] Failed to persist post-call review:', stateError)
      })
    } catch (processingError) {
      await markDialerPostCallUnavailable({
        clientAttemptId,
        leadId,
        providerCallSid: callSid || null,
        recordingSid,
        failureCode: 'processing_failed',
      }).catch((stateError) => {
        console.error('[recording-callback] Failed to mark post-call review failure:', stateError)
      })
      await markRecordingProcessing(processingClaim, 'failed', processingError).catch((stateError) => {
        console.error('[recording-callback] Failed to record processing failure:', stateError)
      })
      throw processingError
    }

    return NextResponse.json({ ok: true, leadId, processed: true })
  } catch (err) {
    console.error('[recording-callback] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

async function processRecording(
  recordingUrl: string,
  recordingSid: string,
  leadId: string,
  duration: number,
  context: RecordingContext = {},
): Promise<CallAnalysisResult | null> {
  // 1. Download recording
  const filePath = await downloadRecording(recordingUrl, recordingSid)

  // 2. Transcribe with Groq Whisper
  const transcript = await transcribeAudio(filePath)

  if (!transcript || transcript.length < 10) {
    console.log(`[recording-callback] Transcript too short, skipping analysis`)
    return null
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

    // 6. Persist factual call evidence. AI-extracted lead fields are written
    // only through the explicit ai_change_proposals approval boundary.
    await supabase.from('leads').update({
      transcript,
      call_duration_seconds: duration,
      updated_at: new Date().toISOString(),
    }).eq('id', leadId)
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
    await updateManifestAndCascade(leadId, (baseManifest) => {
      const manifest = baseManifest as unknown as MutableManifest
      // Store transcript
      if (!manifest.communications) manifest.communications = { transcripts: [] }
      manifest.communications.transcripts.push({
        id: `call-${recordingSid}`,
        date: new Date().toISOString(),
        duration,
        agent: 'Casey',
        recordingUrl: recordingUrl + '.mp3',
        source: context.source || 'twilio_recording_callback',
        trafficSource: context.traffic_source || null,
        campaign: context.campaign || null,
        calledNumber: context.calledNumber || context.to || null,
        callerPhone: context.from || null,
        fullTranscript: transcript,
        aiSummary: analysis?.summary || analysis?.aiSummary || null,
        extractedData: null,
      })

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
          source: context.source || 'twilio_recording_callback',
          traffic_source: context.traffic_source || null,
          campaign: context.campaign || null,
          calledNumber: context.calledNumber || context.to || null,
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
  return analysis
}
