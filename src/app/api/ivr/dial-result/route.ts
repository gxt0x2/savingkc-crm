import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAgentRouting } from '@/lib/agent-routing'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

export async function POST(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || ''
  const leadId = url.searchParams.get('leadId') || ''
  const calledNumber = url.searchParams.get('calledNumber') || ''
  const type = url.searchParams.get('type') || 'seller'

  const body = await req.formData()
  const dialStatus = body.get('DialCallStatus') as string
  const dialCallSid = body.get('DialCallSid') as string

  const routing = getAgentRouting(calledNumber)

  if (dialStatus === 'completed') {
    // Agent answered — log it
    if (leadId) {
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'call',
        description: `Inbound ${type === 'seller' ? 'seller' : 'caller'} connected live with agent`,
        agent: 'System',
        metadata: { outcome: 'connected', direction: 'inbound', dialCallSid, type }
      })

      // Mark any pending callback tasks done
      const { data: pendingTasks } = await supabase
        .from('lead_activities')
        .select('id, metadata')
        .eq('lead_id', leadId)
        .eq('activity_type', 'task')

      if (pendingTasks) {
        for (const task of pendingTasks) {
          if (task.metadata?.status === 'pending') {
            await supabase.from('lead_activities')
              .update({ metadata: { ...task.metadata, status: 'completed' } })
              .eq('id', task.id)
          }
        }
      }
    }
    return new NextResponse('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
  }

  // Nobody answered — escalate
  if (leadId) {
    // Alert both agents via SMS
    const missedMsg = `MISSED: Inbound ${type === 'seller' ? 'seller' : 'caller'} ${from} — nobody answered. Going to voicemail.\n${BASE_URL}/leads/${leadId}`
    await Promise.allSettled([
      twilio.messages.create({ body: missedMsg, from: TWILIO_PHONE, to: routing.primary.phone }),
      twilio.messages.create({ body: missedMsg, from: TWILIO_PHONE, to: routing.secondary.phone }),
    ])

    // Log missed call
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'call',
      description: `Both agents missed inbound ${type} call from ${from}`,
      agent: 'System',
      metadata: { outcome: 'missed', direction: 'inbound', dialStatus, type }
    })

    // Create urgent callback task
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'task',
      description: `URGENT: Call back ${from} — both agents missed`,
      agent: 'Ari',
      metadata: {
        task_type: 'callback',
        due_date: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        assigned_to: routing.primary.name,
        priority: 'critical',
        status: 'pending',
        seller_phone: from
      }
    })
  }

  // Route caller to voicemail
  const vmAgent = routing.primary.name
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${BASE_URL}/api/ivr/voicemail?agent=${encodeURIComponent(vmAgent)}&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(leadId)}</Redirect>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
