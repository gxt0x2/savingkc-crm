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
  let resolvedLeadId = url.searchParams.get('leadId') || ''

  const body = await req.formData()
  const recordingUrl = body.get('RecordingUrl') as string
  const recordingSid = body.get('RecordingSid') as string
  const recordingDuration = body.get('RecordingDuration') as string

  // If no leadId, try to find or create lead by phone number
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
      // Create lead so voicemail isn't orphaned
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

  // Log voicemail to lead_activities — always linked to a lead now
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

  // SMS notify the agent — if no specific agent, notify BOTH
  const agentPhone = AGENT_PHONES[agent]
  const vmMsg = `📩 New voicemail from ${from} (${recordingDuration}s). Listen: ${recordingUrl}${resolvedLeadId ? `\n${BASE_URL}/leads/${resolvedLeadId}` : ''}`

  if (agentPhone) {
    try {
      await twilio.messages.create({ body: vmMsg, from: TWILIO_PHONE, to: agentPhone })
    } catch (e) {
      console.error(`Voicemail SMS notification to ${agent} failed:`, e)
    }
  } else {
    // No specific agent — notify both
    await Promise.allSettled([
      twilio.messages.create({ body: vmMsg, from: TWILIO_PHONE, to: CASEY_PHONE }),
      twilio.messages.create({ body: vmMsg, from: TWILIO_PHONE, to: ERNEST_PHONE }),
    ])
  }

  // Ari briefing event — always create
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

  return new NextResponse('<Response><Say voice="Polly.Matthew">Thank you. Goodbye.</Say><Hangup /></Response>', {
    headers: { 'Content-Type': 'text/xml' }
  })
}
