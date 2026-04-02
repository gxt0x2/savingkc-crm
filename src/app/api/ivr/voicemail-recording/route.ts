import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushToAgents } from '@/lib/push-notifications'
import { downloadRecording } from '@/lib/mojo-recording-downloader'
import { transcribeAudio } from '@/lib/mojo-transcriber'
import { analyzeCallTranscript } from '@/lib/mojo-call-analyzer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

const ERNEST_PHONE = process.env.ERNEST_PHONE || '+18162262552'
const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

const AGENT_PHONES: Record<string, string> = {
  Ernest: ERNEST_PHONE,
  Casey: CASEY_PHONE,
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const agent = url.searchParams.get('agent') || ''
  const from = url.searchParams.get('from') || ''
  let resolvedLeadId = url.searchParams.get('leadId') || ''

  const body = await req.formData()
  const recordingUrl = body.get('RecordingUrl') as string
  const recordingSid = body.get('RecordingSid') as string
  const recordingDuration = body.get('RecordingDuration') as string

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
        full_name: `Voicemail Caller (${from})`,
        phone: from,
        source: 'inbound_voicemail',
        station: 'intake',
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

  // SMS notify the agent
  const agentPhone = AGENT_PHONES[agent]
  const vmMsg = `New voicemail from ${from} (${recordingDuration}s). Listen: ${recordingUrl}${resolvedLeadId ? `\n${BASE_URL}/leads/${resolvedLeadId}` : ''}`

  if (agentPhone) {
    try {
      await twilio.messages.create({ body: vmMsg, from: TWILIO_PHONE, to: agentPhone })
    } catch (e) {
      console.error(`Voicemail SMS notification to ${agent} failed:`, e)
    }
  } else {
    await Promise.allSettled([
      twilio.messages.create({ body: vmMsg, from: TWILIO_PHONE, to: CASEY_PHONE }),
      twilio.messages.create({ body: vmMsg, from: TWILIO_PHONE, to: ERNEST_PHONE }),
    ])
  }

  // Push notification
  sendPushToAgents({
    title: 'New Voicemail',
    body: `Voicemail from ${from} (${recordingDuration}s)`,
    url: resolvedLeadId ? `/leads/${resolvedLeadId}` : '/',
    tag: 'voicemail',
  }).catch(() => {})

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
  const leadUpdates: Record<string, any> = {}
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
      await supabase.from('manifests').update({
        ai_call_analysis: analysis,
        last_call_transcript: transcript,
      }).eq('id', manifest.id)
    } catch {}
  }
}
