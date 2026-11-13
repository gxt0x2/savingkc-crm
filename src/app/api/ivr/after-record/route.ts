import { formatPhone } from '@/lib/format'
import { NextResponse } from 'next/server'
import { downloadRecording } from '@/lib/mojo-recording-downloader'
import { transcribeAudio } from '@/lib/mojo-transcriber'
import { analyzeCallTranscript } from '@/lib/mojo-call-analyzer'
import { sendTeamLeadAlert } from '@/lib/lead-team-alerts'
import { supabase } from '@/lib/supabase-lazy'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import { createCallAnalysisLeadProposal } from '@/lib/server/ai-change-proposals'
import { hasExplicitSellingIntent } from '@/lib/selling-intent'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

/**
 * Voicemail handler — only triggered when BOTH agents miss the call.
 * Creates/updates lead, alerts agents, triggers transcript analysis.
 */
export async function POST(req: Request) {
  try {
    if (!(await validateTwilioWebhook(req))) {
      return NextResponse.json({ error: 'Invalid Twilio signature' }, { status: 403 })
    }

    const url = new URL(req.url)
    const from = url.searchParams.get('from') || ''
    const callSid = url.searchParams.get('callSid') || ''
    const calledNumber = url.searchParams.get('calledNumber') || ''

    const body = await req.formData()
    const recordingUrl = body.get('RecordingUrl') as string
    const recordingSid = body.get('RecordingSid') as string
    const recordingDuration = Number.parseInt(String(body.get('RecordingDuration') || '0'), 10) || 0

  // Find or create lead (dedup by phone)
  let leadId = ''
  if (from) {
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', from)
      .limit(1)
      .single()

    if (existingLead?.id) {
      leadId = existingLead.id
    } else {
      const { data: newLead } = await supabase.from('leads').insert({
        full_name: 'Inbound Seller',
        phone: from,
        source: 'inbound_ivr',
        station: 'new',
        priority: 'warm',
        notes: `Inbound IVR voicemail. Recording: ${recordingUrl}. CallSid: ${callSid}`
      }).select('id').single()
      leadId = newLead?.id || ''
    }
  }

  // Log the voicemail recording
  if (leadId) {
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'voicemail',
      description: 'Voicemail left after both agents missed the call',
      agent: 'System',
      metadata: {
        direction: 'inbound',
        from,
        callSid,
        recordingUrl,
        recordingSid,
        source: 'ivr_voicemail'
      }
    })
  }

  // Alert eligible agents.
  const urgentMsg = `Voicemail from ${formatPhone(from)}. Call them back. Recording: ${recordingUrl}${leadId ? '\n' + BASE_URL + '/leads/' + leadId : ''}`
  await sendTeamLeadAlert({
    leadId,
    smsBody: urgentMsg,
    trigger: 'inbound_seller_voicemail_alert',
    source: 'inbound_ivr',
    calledNumber,
    push: leadId ? {
      title: 'Voicemail',
      body: `Voicemail from ${formatPhone(from)}. Call them back.`,
      url: `/leads/${leadId}`,
      tag: 'inbound-seller-voicemail',
    } : false,
    metadata: {
      from,
      calledNumber,
      callSid,
      recordingUrl,
      recordingSid,
    },
  })

  if (leadId) {
    await supabase.from('ari_briefing_events').insert({
      event_type: 'inbound_seller_voicemail',
      priority: 'critical',
      title: `Voicemail from ${formatPhone(from)}`,
      description: 'Both agents missed. Voicemail left. Call them back.',
      lead_id: leadId,
      action_url: `/leads/${leadId}`
    })
  }

  // Async transcript analysis (fire-and-forget)
  if (recordingUrl && leadId) {
    transcribeAndAnalyze(recordingUrl, recordingSid, leadId, recordingDuration, from).catch(err =>
      console.error('Voicemail transcript analysis failed:', err)
    )
  }

  return new NextResponse('<Response><Say voice="Polly.Matthew">Thank you. We\'ll call you back shortly.</Say><Hangup /></Response>', {
    headers: { 'Content-Type': 'text/xml' }
  })
  } catch (error) {
    console.error('[IVR/after-record] Critical error:', error)
    // Fallback: just acknowledge and hang up
    return new NextResponse('<Response><Say voice="Polly.Matthew">Thank you.</Say><Hangup /></Response>', {
      headers: { 'Content-Type': 'text/xml' }
    })
  }
}

async function transcribeAndAnalyze(recordingUrl: string, recordingSid: string, leadId: string, duration: number, from: string) {
  const filePath = await downloadRecording(recordingUrl, recordingSid)
  const transcript = await transcribeAudio(filePath)

  if (!transcript || transcript.length < 10) return

  const selling = hasExplicitSellingIntent(transcript)
  if (selling.intent) {
    const { error: promoteError } = await supabase.from('leads').update({
      classification: 'lead',
      priority: 'hot',
    }).eq('id', leadId)
    if (promoteError) throw promoteError
    await sendTeamLeadAlert({
      leadId,
      smsBody: `Seller intent in a voicemail from ${formatPhone(from)}: "${selling.quote}"`,
      trigger: 'voicemail_selling_intent_alert',
      source: 'inbound_ivr',
      push: {
        title: 'Voicemail selling intent',
        body: selling.quote.slice(0, 140),
        url: `/leads/${leadId}`,
        tag: 'voicemail-selling-intent',
      },
      metadata: { intent_quote: selling.quote, intent_reason: selling.reason, recordingSid },
    })
  }

  // Save transcript to lead activity
  const { error: transcriptError } = await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'note',
    description: `Voicemail transcript: ${transcript}`,
    agent: 'AI',
    metadata: { source: 'whisper_transcription', recordingSid, recordingUrl, duration }
  })
  if (transcriptError) throw transcriptError

  // Analyze transcript
  const analysis = await analyzeCallTranscript(transcript)

  const { error: leadEvidenceError } = await supabase.from('leads').update({
    transcript,
    call_duration_seconds: duration,
    updated_at: new Date().toISOString(),
  }).eq('id', leadId)
  if (leadEvidenceError) throw leadEvidenceError

  // Save analysis to lead activity
  const { error: analysisError } = await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'note',
    description: `AI Analysis: ${analysis.aiSummary || analysis.summary || 'Analysis complete'}`,
    agent: 'AI',
    metadata: { source: 'call_analysis', recordingSid, recordingUrl, duration, analysis }
  })
  if (analysisError) throw analysisError

  await createCallAnalysisLeadProposal({
    leadId,
    clientAttemptId: null,
    recordingSid,
    analysis,
  }).catch((error) => console.error('[ivr/after-record] AI proposal persistence failed:', error))
}
