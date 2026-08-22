import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

import { downloadRecording } from '@/lib/mojo-recording-downloader'
import { transcribeAudio } from '@/lib/mojo-transcriber'
import { analyzeCallTranscript } from '@/lib/mojo-call-analyzer'
import { ensureManifestExists } from '@/lib/manifest-sync'
import { sendTeamLeadAlert } from '@/lib/lead-team-alerts'
import { formatPhone } from '@/lib/format'
import type { ManifestV2 } from '@/lib/manifest-builder'
import { validateTwilioWebhook } from '@/lib/twilio-validate'


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

  // Ensure manifest exists (fire-and-forget)
  if (resolvedLeadId) ensureManifestExists(resolvedLeadId).catch(err => console.error('[MANIFEST] Failed:', err))

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

  // Create callback task
  if (resolvedLeadId) {
    await supabase.from('lead_activities').insert({
      lead_id: resolvedLeadId,
      activity_type: 'task',
      description: `Listen & callback: Voicemail from ${from} (${recordingDuration}s)`,
      agent: 'System',
      metadata: {
        task_type: 'callback',
        due_date: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        assigned_to: agent || 'Casey',
        priority: 'high',
        status: 'pending',
        source: 'twilio_voicemail',
        recording_sid: recordingSid,
        recordingUrl,
      }
    })
  }

  // Async transcript analysis (fire-and-forget)
  if (recordingUrl && resolvedLeadId) {
    transcribeAndAnalyze(recordingUrl, recordingSid, resolvedLeadId).catch(err =>
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

async function transcribeAndAnalyze(recordingUrl: string, recordingSid: string, leadId: string) {
  const filePath = await downloadRecording(recordingUrl, recordingSid)
  const transcript = await transcribeAudio(filePath)

  if (!transcript || transcript.length < 10) return

  // Save transcript
  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'note',
    description: `Voicemail transcript: ${transcript}`,
    agent: 'AI',
    metadata: { source: 'whisper_transcription', recordingSid }
  })

  // Analyze transcript
  const analysis = await analyzeCallTranscript(transcript)

  // Update lead with extracted fields
  const leadUpdates: Record<string, unknown> = {}
  if (analysis.motivationScore) leadUpdates.motivation_score = analysis.motivationScore
  if (analysis.urgency) leadUpdates.urgency = analysis.urgency
  if (analysis.conditionOverall) leadUpdates.property_condition = analysis.conditionOverall
  if (analysis.sellerAsking) leadUpdates.asking_price = analysis.sellerAsking

  if (Object.keys(leadUpdates).length > 0) {
    try { await supabase.from('leads').update(leadUpdates).eq('id', leadId) } catch {}
  }

  // Save analysis
  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'note',
    description: `AI Analysis: ${analysis.aiSummary || analysis.summary || 'Analysis complete'}`,
    agent: 'AI',
    metadata: { source: 'call_analysis', analysis }
  })

  // Update manifest if exists
  const { data: manifest } = await supabase
    .from('manifests')
    .select('id')
    .eq('lead_id', leadId)
    .single()

  if (manifest?.id) {
    try {
      const { updateManifestAndCascade } = await import('@/lib/manifest-sync')
      const motivationScore = typeof analysis?.motivation_score === 'number' ? analysis.motivation_score : undefined
      await updateManifestAndCascade(leadId, (manifest: ManifestV2) => {
        if (!manifest.communications) manifest.communications = { transcripts: [] }
        manifest.communications.transcripts.push({
          id: `call-${Date.now()}`,
          date: new Date().toISOString(),
          duration: 0,
          agent: 'System',
          recordingUrl: null,
          fullTranscript: transcript,
          aiSummary: analysis?.summary || analysis?.aiSummary || null,
          extractedData: analysis ? {
            ...(motivationScore != null ? { motivationScore } : {}),
            sentiment: analysis.sentiment,
          } : null,
        })
        if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
        manifest.ariIntelligence.briefingStale = true
      }, 'ivr:call_analysis')
    } catch (err) {
      console.error('[ivr/voicemail-recording] Manifest cascade failed:', err)
    }
  }
}
