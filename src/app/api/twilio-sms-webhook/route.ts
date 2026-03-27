import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const body = await req.formData()
    const from = body.get('From') as string
    const to = body.get('To') as string
    const messageBody = body.get('Body') as string
    const messageSid = body.get('MessageSid') as string

    if (!from || !messageBody) {
      return new NextResponse('Missing required fields', { status: 400 })
    }

    // Match sender phone number to a lead in the database
    const { data: leads, error: searchError } = await supabase
      .from('leads')
      .select('id, full_name, phone')
      .eq('phone', from)
      .limit(1)

    if (searchError) {
      console.error('Error searching for lead:', searchError)
    }

    const leadId = leads && leads.length > 0 ? leads[0].id : null
    const leadName = leads && leads.length > 0 ? leads[0].full_name : 'Unknown'

    // Log the inbound SMS to lead_activities
    const { error: insertError } = await supabase
      .from('lead_activities')
      .insert({
        lead_id: leadId,
        type: 'sms',
        description: messageBody,
        agent: 'system',
        metadata: {
          direction: 'inbound',
          from: from,
          to: to,
          message_sid: messageSid,
          lead_name: leadName,
        },
      })

    if (insertError) {
      console.error('Error inserting SMS activity:', insertError)
    }

    // Return empty TwiML response (no auto-reply)
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
</Response>`

    return new NextResponse(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    })
    // YES reply from no-input text-back — fire immediate callback task
    if (messageBody.trim().toUpperCase() === 'YES') {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'
      const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
      const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

      let yesLeadId = leadId
      if (!yesLeadId) {
        const { data: newLead } = await supabase.from('leads').insert({
          full_name: 'Inbound Seller (YES reply)',
          phone: from,
          source: 'ivr_yes_reply',
          station: 'intake',
          priority: 'hot',
        }).select().single()
        yesLeadId = newLead?.id
      }

      await twilio.messages.create({
        body: `🔥 HOT — ${from} replied YES to sell. Call NOW.${yesLeadId ? ' ' + BASE_URL + '/leads/' + yesLeadId : ''}`,
        from: TWILIO_PHONE, to: CASEY_PHONE
      }).catch(console.error)

      if (yesLeadId) {
        await supabase.from('lead_activities').insert({
          lead_id: yesLeadId, activity_type: 'task',
          description: `URGENT: ${from} replied YES — call back NOW`,
          agent: 'Ari',
          metadata: { task_type: 'callback', due_date: new Date(Date.now() + 5 * 60 * 1000).toISOString(), assigned_to: 'Casey', priority: 'critical', status: 'pending' }
        })
        await supabase.from('ari_briefing_events').insert({
          event_type: 'yes_reply_seller', priority: 'critical',
          title: `🔥 ${from} replied YES — wants to sell`,
          description: 'Replied YES to no-input text-back. Casey notified.',
          lead_id: yesLeadId, action_url: `/leads/${yesLeadId}`
        })
      }

      await twilio.messages.create({
        body: `Perfect! We'll call you right back in just a few minutes.`,
        from: TWILIO_PHONE, to: from
      }).catch(console.error)
    }


  } catch (err) {
    console.error('Twilio SMS webhook error:', err)
    return new NextResponse('Internal server error', { status: 500 })
  }
}