import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
  const leadId = url.searchParams.get('leadId') || ''

  const body = await req.formData()
  const recordingUrl = body.get('RecordingUrl') as string
  const recordingSid = body.get('RecordingSid') as string
  const recordingDuration = body.get('RecordingDuration') as string

  // Log voicemail to lead_activities
  if (leadId) {
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
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
  } else {
    // No lead — still log as orphan activity
    await supabase.from('lead_activities').insert({
      activity_type: 'voicemail',
      description: `Voicemail from ${from} for ${agent || 'team'} (${recordingDuration}s)`,
      agent: 'System',
      metadata: {
        direction: 'inbound',
        from,
        recordingUrl,
        recordingSid,
        duration: recordingDuration,
        for_agent: agent,
        needs_review: true,
      }
    })
  }

  // SMS notify the agent about the voicemail
  const agentPhone = AGENT_PHONES[agent]
  if (agentPhone) {
    const vmMsg = `📩 New voicemail from ${from} (${recordingDuration}s). Listen: ${recordingUrl}${leadId ? `\n${BASE_URL}/leads/${leadId}` : ''}`
    try {
      await twilio.messages.create({ body: vmMsg, from: TWILIO_PHONE, to: agentPhone })
    } catch (e) {
      console.error(`Voicemail SMS notification to ${agent} failed:`, e)
    }
  }

  // Notify Ari briefing if we have a lead
  if (leadId) {
    try {
      await supabase.from('ari_briefing_events').insert({
        event_type: 'voicemail_received',
        priority: 'high',
        title: `Voicemail from ${from} for ${agent || 'team'}`,
        description: `${recordingDuration}s voicemail. Recording: ${recordingUrl}`,
        lead_id: leadId,
        action_url: `/leads/${leadId}`
      })
    } catch {}
  }

  return new NextResponse('<Response><Say voice="Polly.Matthew">Thank you. Goodbye.</Say><Hangup /></Response>', {
    headers: { 'Content-Type': 'text/xml' }
  })
}
