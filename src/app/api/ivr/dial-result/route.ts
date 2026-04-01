import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

const ERNEST_PHONE = process.env.ERNEST_PHONE || '+18162262552'
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'


function isOfficeHours(): boolean {
  const now = new Date()
  const cst = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const hour = cst.getHours()
  return hour >= 9 && hour < 17
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || ''
  const leadId = url.searchParams.get('leadId') || ''

  const body = await req.formData()
  const dialStatus = body.get('DialCallStatus') as string

  if (dialStatus === 'completed') {
    // Casey connected — log it
    if (leadId) {
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'call',
        description: 'Inbound seller connected live with Casey',
        agent: 'System',
        metadata: { outcome: 'connected', direction: 'inbound' }
      })
      // Mark callback task done
      await supabase.from('lead_activities')
        .update({ metadata: { status: 'completed' } })
        .eq('lead_id', leadId)
        .eq('activity_type', 'task')
        .contains('metadata', { assigned_to: 'Casey' })
    }
    return new NextResponse('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
  }

  // Primary didn't answer — escalate appropriately
  const url2 = new URL(req.url)
  const primary = url2.searchParams.get('primary') || 'Casey'

  if (isOfficeHours() && primary === 'Casey') {
    // Business hours: Casey missed it → escalate to Ernest
    const ernestMsg = `🚨 ESCALATION — Inbound seller ${from} called in, Casey missed it. Call back NOW.\n${BASE_URL}/leads/${leadId}`
    try {
      await twilio.messages.create({ body: ernestMsg, from: TWILIO_PHONE, to: ERNEST_PHONE })
      // Log escalation
      if (leadId) {
        await supabase.from('lead_activities').insert({
          lead_id: leadId,
          activity_type: 'sms',
          description: ernestMsg,
          agent: 'System',
          metadata: { direction: 'outbound_alert', to: 'Ernest', trigger: 'escalation_casey_missed' },
        }).catch(() => {})
      }
    } catch (e) { console.error('Ernest escalation text failed:', e) }
  }
  // After hours: Ernest was already primary — Ari will text seller at 10 min (handled by task)

  // Schedule Ari text-back in 10 min if NEITHER calls back
  // (handled by a cron that checks pending IVR leads)
  if (leadId) {
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'task',
      description: `ESCALATED: Neither Casey nor Ernest called back ${from}`,
      agent: 'Ari',
      metadata: {
        task_type: 'ari_textback',
        due_date: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        assigned_to: 'Ari',
        status: 'pending',
        seller_phone: from
      }
    })
  }

  // Route caller to agent's voicemail instead of hanging up
  const vmAgent = primary || (isOfficeHours() ? 'Casey' : 'Ernest')
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${BASE_URL}/api/ivr/voicemail?agent=${encodeURIComponent(vmAgent)}&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(leadId)}</Redirect>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
