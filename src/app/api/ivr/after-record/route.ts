import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'
const ERNEST_PHONE = process.env.ERNEST_PHONE || '+18413737722'
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'


function isOfficeHours(): boolean {
  // 9AM - 5PM CST (UTC-6, or UTC-5 during DST)
  const now = new Date()
  const cst = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const hour = cst.getHours()
  return hour >= 9 && hour < 17
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || ''
  const callSid = url.searchParams.get('callSid') || ''

  const body = await req.formData()
  const recordingUrl = body.get('RecordingUrl') as string
  const recordingSid = body.get('RecordingSid') as string

  // Create lead immediately — caller ID is the phone number
  const { data: newLead } = await supabase
    .from('leads')
    .insert({
      full_name: 'Inbound Seller',
      phone: from,
      source: 'inbound_ivr',
      station: 'intake',
      priority: 'hot',
      notes: `Inbound IVR call. Recording: ${recordingUrl}. CallSid: ${callSid}`
    })
    .select()
    .single()

  const leadId = newLead?.id

  // Log the call + recording
  if (leadId) {
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'call',
      description: 'Inbound seller — pressed 1, left name/address recording',
      agent: 'System',
      metadata: {
        direction: 'inbound',
        from,
        callSid,
        recordingUrl,
        recordingSid,
        source: 'ivr_press_1'
      }
    })
  }

  // Text the right person based on office hours
  const primaryRecipient = isOfficeHours() ? CASEY_PHONE : ERNEST_PHONE
  const primaryName = isOfficeHours() ? 'Casey' : 'Ernest'
  const urgentMsg = `🔥 INBOUND SELLER — ${from}. Just called in. Recording: ${recordingUrl}\nCall back NOW.`
  try {
    await twilio.messages.create({ body: urgentMsg, from: TWILIO_PHONE, to: primaryRecipient })
  } catch (e) { console.error('Alert text failed:', e) }

  // Create 3-min callback task for Casey
  const due3min = new Date(Date.now() + 3 * 60 * 1000).toISOString()
  if (leadId) {
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'task',
      description: `URGENT: Call back inbound seller at ${from}`,
      agent: 'Ari',
      metadata: {
        task_type: 'callback',
        due_date: due3min,
        assigned_to: isOfficeHours() ? 'Casey' : 'Ernest',
        priority: 'critical',
        status: 'pending',
        escalate_after_minutes: 3,
        escalate_to: ERNEST_PHONE
      }
    })

    // Ari briefing event
    await supabase.from('ari_briefing_events').insert({
      event_type: 'inbound_seller_ivr',
      priority: 'critical',
      title: `🔥 Inbound seller called in from ${from}`,
      description: `Pressed 1, left recording. Casey notified. Callback task due in 3 min.`,
      lead_id: leadId,
      action_url: `/leads/${leadId}`
    })
  }

  // Schedule 10-min Ari text-back if nobody calls (via separate cron check)
  // Store the timestamp so the cron can check it
  if (leadId) {
    await supabase.from('leads').update({
      notes: `Inbound IVR. Recording: ${recordingUrl}. Callback deadline: ${new Date(Date.now() + 10 * 60 * 1000).toISOString()}`
    }).eq('id', leadId)
  }

  // Route based on office hours
  const primaryPhone = isOfficeHours() ? CASEY_PHONE : ERNEST_PHONE
  const primaryLabel = isOfficeHours() ? 'Casey' : 'Ernest'

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${BASE_URL}/api/ivr/dial-result?from=${encodeURIComponent(from)}&leadId=${leadId || ''}&primary=${encodeURIComponent(primaryLabel)}" method="POST" timeout="15" callerId="${TWILIO_PHONE}">
    <Number>${primaryPhone}</Number>
  </Dial>
  <!-- If primary doesn't answer -->
  <Say voice="Polly.Joanna">Our team is helping another homeowner right now, but we want to talk to you. We'll call you back in the next few minutes — keep your phone close.</Say>
  <Hangup />
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
