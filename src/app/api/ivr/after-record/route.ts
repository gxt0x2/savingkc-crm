import { NextResponse } from 'next/server'
import { downloadRecording } from '@/lib/mojo-recording-downloader'
import { transcribeAudio } from '@/lib/mojo-transcriber'
import { analyzeCallTranscript } from '@/lib/mojo-call-analyzer'
import { sendTeamLeadAlert } from '@/lib/lead-team-alerts'
import { supabase } from '@/lib/supabase-lazy'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import { createCallAnalysisLeadProposal } from '@/lib/server/ai-change-proposals'

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
      const { error: priorityError } = await supabase.from('leads').update({ priority: 'hot' }).eq('id', leadId)
      if (priorityError) throw priorityError
    } else {
      const { data: newLead } = await supabase.from('leads').insert({
        full_name: 'Inbound Seller',
        phone: from,
        source: 'inbound_ivr',
        station: 'new',
        priority: 'hot',
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
      description: 'Voicemail left after both agents missed inbound seller call',
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
  const urgentMsg = `[URGENT] Inbound seller voicemail from ${from}. Recording: ${recordingUrl}${leadId ? '\n' + BASE_URL + '/leads/' + leadId : ''}\nCall back NOW.`
  await sendTeamLeadAlert({
    leadId,
    smsBody: urgentMsg,
    trigger: 'inbound_seller_voicemail_alert',
    source: 'inbound_ivr',
    push: leadId ? {
      title: 'Inbound Seller Voicemail',
      body: `Voicemail from ${from}. Call back now.`,
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
      title: `[URGENT] Inbound seller voicemail from ${from}`,
      description: `Both agents missed. Voicemail left and the conversation needs a reply.`,
      lead_id: leadId,
      action_url: `/leads/${leadId}`
    })
  }

  // Async transcript analysis (fire-and-forget)
  if (recordingUrl && leadId) {
    transcribeAndAnalyze(recordingUrl, recordingSid, leadId, recordingDuration).catch(err =>
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

async function transcribeAndAnalyze(recordingUrl: string, recordingSid: string, leadId: string, duration: number) {
  const filePath = await downloadRecording(recordingUrl, recordingSid)
  const transcript = await transcribeAudio(filePath)

  if (!transcript || transcript.length < 10) return

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
