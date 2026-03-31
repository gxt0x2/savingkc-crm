import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isOptedOut, handleOptOut, handleOptIn, isStopKeyword, isStartKeyword } from '@/lib/sms-opt-out'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import { rateLimit, rateLimitConfigs, getClientIp, phoneRateLimit } from '@/middleware/rate-limit'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    // Twilio signature validation
    const isValid = await validateTwilioWebhook(req)
    if (!isValid) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    // IP-based rate limiting
    const ip = getClientIp(req)
    const { allowed } = rateLimit(ip, rateLimitConfigs.webhook)
    if (!allowed) {
      return new NextResponse('Rate limited', { status: 429 })
    }

    const body = await req.formData()
    const from = body.get('From') as string
    const to = body.get('To') as string
    const messageBody = body.get('Body') as string
    const messageSid = body.get('MessageSid') as string

    if (!from || !messageBody) {
      return new NextResponse('Missing required fields', { status: 400 })
    }

    const trimmedUpper = messageBody.trim().toUpperCase()

    // --- TCPA: STOP keyword handling (before ANY processing) ---
    if (isStopKeyword(messageBody)) {
      await handleOptOut(from, messageBody.trim())
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You have been unsubscribed from Saving KC messages. Reply START to re-subscribe.</Message>
</Response>`
      return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
    }

    // --- TCPA: START keyword handling ---
    if (isStartKeyword(messageBody)) {
      await handleOptIn(from)
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You have been re-subscribed to Saving KC messages. Reply STOP to unsubscribe.</Message>
</Response>`
      return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
    }

    // --- "YES" from opted-out number = opt-in, not seller confirmation ---
    if (trimmedUpper === 'YES' && await isOptedOut(from)) {
      await handleOptIn(from)
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You have been re-subscribed to Saving KC messages. Reply STOP to unsubscribe.</Message>
</Response>`
      return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
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
        activity_type: 'sms',
        description: messageBody,
        agent: 'system',
        metadata: {
          direction: 'received',
          from: from,
          to: to,
          message_sid: messageSid,
          lead_name: leadName,
        },
      })

    if (insertError) {
      console.error('Error inserting SMS activity:', insertError)
    }

    // --- YES reply handler (FIXED: was dead code after return) ---
    if (trimmedUpper === 'YES') {
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
      } else {
        // Existing lead — mark hot
        await supabase.from('leads').update({ priority: 'hot' }).eq('id', yesLeadId)
      }

      // Alert Casey
      await twilio.messages.create({
        body: `[URGENT] HOT — ${from} replied YES to sell. Call NOW.${yesLeadId ? ' ' + BASE_URL + '/leads/' + yesLeadId : ''}`,
        from: TWILIO_PHONE, to: CASEY_PHONE
      }).catch(console.error)

      if (yesLeadId) {
        // Create callback task
        await supabase.from('lead_activities').insert({
          lead_id: yesLeadId, activity_type: 'task',
          description: `URGENT: ${from} replied YES — call back NOW`,
          agent: 'System',
          metadata: { task_type: 'callback', due_date: new Date(Date.now() + 5 * 60 * 1000).toISOString(), assigned_to: 'Casey', priority: 'critical', status: 'pending' }
        })
        // Ari briefing event
        await supabase.from('ari_briefing_events').insert({
          event_type: 'yes_reply_seller', priority: 'critical',
          title: `[URGENT] ${from} replied YES — wants to sell`,
          description: 'Replied YES to no-input text-back. Casey notified.',
          lead_id: yesLeadId, action_url: `/leads/${yesLeadId}`
        })
      }

      // Confirmation reply to seller
      await twilio.messages.create({
        body: `Perfect! We'll call you right back in just a few minutes.`,
        from: TWILIO_PHONE, to: from
      }).catch(console.error)
    }

    // Return empty TwiML response
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
</Response>`

    return new NextResponse(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    })

  } catch (err) {
    console.error('Twilio SMS webhook error:', err)
    return new NextResponse('Internal server error', { status: 500 })
  }
}
