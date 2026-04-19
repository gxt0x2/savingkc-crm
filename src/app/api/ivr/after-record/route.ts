import { NextResponse } from 'next/server'
import { getAgentRouting } from '@/lib/agent-routing'
import { downloadRecording } from '@/lib/mojo-recording-downloader'
import { transcribeAudio } from '@/lib/mojo-transcriber'
import { analyzeCallTranscript } from '@/lib/mojo-call-analyzer'
import { ensureManifestExists } from '@/lib/manifest-sync'
import { safeSendSMS } from '@/lib/safe-communications'
import { supabase } from '@/lib/supabase-lazy'

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

/**
 * Voicemail handler — only triggered when BOTH agents miss the call.
 * Creates/updates lead, alerts agents, triggers transcript analysis.
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const from = url.searchParams.get('from') || ''
    const callSid = url.searchParams.get('callSid') || ''
    const calledNumber = url.searchParams.get('calledNumber') || ''

    const body = await req.formData()
    const recordingUrl = body.get('RecordingUrl') as string
    const recordingSid = body.get('RecordingSid') as string

    const routing = getAgentRouting(calledNumber)

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
      // Bump to hot via manifest cascade (with fallback if manifest ops fail)
      try {
        const { updateManifestAndCascade } = await import('@/lib/manifest-sync')
        const cascaded = await updateManifestAndCascade(leadId, (m) => {
          m.priority = 'hot'
        }, 'system:ivr_voicemail')
        if (!cascaded) {
          // No manifest yet - fallback to direct update
          await supabase.from('leads').update({ priority: 'hot' }).eq('id', leadId)
        }
      } catch (err) {
        console.error('[IVR] Manifest update failed, using direct fallback:', err)
        await supabase.from('leads').update({ priority: 'hot' }).eq('id', leadId)
      }
    } else {
      const { data: newLead } = await supabase.from('leads').insert({
        full_name: 'Inbound Seller',
        phone: from,
        source: 'inbound_ivr',
        station: 'intake',
        priority: 'hot',
        notes: `Inbound IVR voicemail. Recording: ${recordingUrl}. CallSid: ${callSid}`
      }).select('id').single()
      leadId = newLead?.id || ''
    }
  }

  // Ensure manifest exists (fire-and-forget)
  if (leadId) ensureManifestExists(leadId).catch(err => console.error('[MANIFEST] Failed:', err))

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

  // Alert both agents
  const urgentMsg = `[URGENT] Inbound seller voicemail from ${from}. Recording: ${recordingUrl}${leadId ? '\n' + BASE_URL + '/leads/' + leadId : ''}\nCall back NOW.`
  await Promise.allSettled([
    safeSendSMS({ body: urgentMsg, from: TWILIO_PHONE, to: routing.primary.phone }),
    safeSendSMS({ body: urgentMsg, from: TWILIO_PHONE, to: routing.secondary.phone }),
  ])

  // Create callback task
  if (leadId) {
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'task',
      description: `URGENT: Call back inbound seller at ${from} — voicemail left`,
      agent: 'Ari',
      metadata: {
        task_type: 'callback',
        due_date: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
        assigned_to: routing.primary.name,
        priority: 'critical',
        status: 'pending',
        escalate_after_minutes: 3,
        escalate_to: routing.secondary.phone
      }
    })

    await supabase.from('ari_briefing_events').insert({
      event_type: 'inbound_seller_voicemail',
      priority: 'critical',
      title: `[URGENT] Inbound seller voicemail from ${from}`,
      description: `Both agents missed. Voicemail left. Callback task created.`,
      lead_id: leadId,
      action_url: `/leads/${leadId}`
    })
  }

  // Async transcript analysis (fire-and-forget)
  if (recordingUrl && leadId) {
    transcribeAndAnalyze(recordingUrl, recordingSid, leadId).catch(err =>
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

async function transcribeAndAnalyze(recordingUrl: string, recordingSid: string, leadId: string) {
  const filePath = await downloadRecording(recordingUrl, recordingSid)
  const transcript = await transcribeAudio(filePath)

  if (!transcript || transcript.length < 10) return

  // Save transcript to lead activity
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

  // Save analysis to lead activity
  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'note',
    description: `AI Analysis: ${analysis.aiSummary || analysis.summary || 'Analysis complete'}`,
    agent: 'AI',
    metadata: { source: 'call_analysis', analysis }
  })

  // Update manifest with analysis if it exists
  const { data: manifest } = await supabase
    .from('manifests')
    .select('id')
    .eq('lead_id', leadId)
    .single()

  if (manifest?.id) {
    try {
      const { updateManifestAndCascade } = await import('@/lib/manifest-sync')
      await updateManifestAndCascade(leadId, (manifest: any) => {
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
            motivationScore: analysis.motivation_score,
            sentiment: analysis.sentiment,
          } : null,
        })
        if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
        manifest.ariIntelligence.briefingStale = true
      }, 'ivr:call_analysis')
    } catch (err) {
      console.error('[ivr/after-record] Manifest cascade failed:', err)
    }
  }
}
