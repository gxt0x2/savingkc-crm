import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

import { downloadRecording } from '@/lib/mojo-recording-downloader'
import { transcribeAudio } from '@/lib/mojo-transcriber'
import { analyzeCallTranscript } from '@/lib/mojo-call-analyzer'
import { sendTeamLeadAlert } from '@/lib/lead-team-alerts'
import { formatPhone } from '@/lib/format'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import { createCallAnalysisLeadProposal } from '@/lib/server/ai-change-proposals'


const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

export async function POST(req: Request) {
  try {
    if (!(await validateTwilioWebhook(req))) {
      return NextResponse.json({ error: 'Invalid Twilio signature' }, { status: 403 })
    }

    const url = new URL(req.url)
    const agent = url.searchParams.get('agent') || ''
    const from = url.searchParams.get('from') || ''
    let resolvedLeadId = url.searchParams.get('leadId') || ''

    const body = await req.formData()
    const recordingUrl = body.get('RecordingUrl') as string
    const recordingSid = body.get('RecordingSid') as string
    const recordingDuration = body.get('RecordingDuration') as string

  if (recordingSid) {
    const { data: existingVoicemail } = await supabase
      .from('lead_activities')
      .select('id')
      .eq('activity_type', 'voicemail')
      .eq('metadata->>recordingSid', recordingSid)
      .limit(1)
      .maybeSingle()

    if (existingVoicemail?.id) {
      return new NextResponse('<Response><Say voice="Polly.Matthew">Thank you. Goodbye.</Say><Hangup /></Response>', {
        headers: { 'Content-Type': 'text/xml' }
      })
    }
  }

  // If no leadId, find or create lead by phone number (dedup)
  if (!resolvedLeadId && from) {
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', from)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (existingLead?.id) {
      resolvedLeadId = existingLead.id
    } else {
      const { data: newLead } = await supabase.from('leads').insert({
        full_name: `Voicemail Caller ${formatPhone(from) || from}`,
        phone: from,
        source: 'inbound_voicemail',
        station: 'new',
        priority: 'hot',
      }).select('id').single()
      resolvedLeadId = newLead?.id || ''
    }
  }

  // Log voicemail to lead_activities
  await supabase.from('lead_activities').insert({
    lead_id: resolvedLeadId || null,
    activity_type: 'voicemail',
    description: `Voicemail left for ${agent || 'team'} (${recordingDuration}s)`,
    agent: 'System',
    metadata: {
      direction: 'inbound',
      from,
      recordingUrl,
      recordingSid,
      duration: recordingDuration,
      for_agent: agent,
    }
  })

  // Notify eligible agents.
  const vmMsg = `New voicemail from ${from} (${recordingDuration}s). Listen: ${recordingUrl}${resolvedLeadId ? `\n${BASE_URL}/leads/${resolvedLeadId}` : ''}`
  await sendTeamLeadAlert({
    leadId: resolvedLeadId,
    smsBody: vmMsg,
    trigger: 'voicemail_recording_alert',
    source: 'inbound_voicemail',
    push: {
      title: 'New Voicemail',
      body: `Voicemail from ${from} (${recordingDuration}s)`,
      url: resolvedLeadId ? `/leads/${resolvedLeadId}` : '/',
      tag: 'voicemail',
    },
    metadata: {
      from,
      recordingUrl,
      recordingSid,
      duration: recordingDuration,
      for_agent: agent || null,
    },
  })

  // Ari briefing event
  try {
    await supabase.from('ari_briefing_events').insert({
      event_type: 'voicemail_received',
      priority: 'high',
      title: `Voicemail from ${from} for ${agent || 'team'}`,
      description: `${recordingDuration}s voicemail. Recording: ${recordingUrl}`,
      lead_id: resolvedLeadId || null,
      action_url: resolvedLeadId ? `/leads/${resolvedLeadId}` : undefined,
    })
  } catch {}

  // Async transcript analysis (fire-and-forget)
  if (recordingUrl && resolvedLeadId) {
    transcribeAndAnalyze(recordingUrl, recordingSid, resolvedLeadId, Number.parseInt(recordingDuration || '0', 10) || 0).catch(err =>
      console.error('Voicemail transcript analysis failed:', err)
    )
  }

  return new NextResponse('<Response><Say voice="Polly.Matthew">Thank you. Goodbye.</Say><Hangup /></Response>', {
    headers: { 'Content-Type': 'text/xml' }
  })
  } catch (error) {
    console.error('[IVR/voicemail-recording] Critical error:', error)
    // Fallback: just acknowledge
    return new NextResponse('<Response><Say voice="Polly.Matthew">Thank you.</Say><Hangup /></Response>', {
      headers: { 'Content-Type': 'text/xml' }
    })
  }
}

async function transcribeAndAnalyze(recordingUrl: string, recordingSid: string, leadId: string, duration: number) {
  const filePath = await downloadRecording(recordingUrl, recordingSid)
  const transcript = await transcribeAudio(filePath)

  if (!transcript || transcript.length < 10) return

  // Save transcript
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

  // Save analysis
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
  }).catch((error) => console.error('[ivr/voicemail-recording] AI proposal persistence failed:', error))
}
