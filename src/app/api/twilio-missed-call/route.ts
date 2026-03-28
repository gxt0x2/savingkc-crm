import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const twilio = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

const ERNEST_PHONE = process.env.ERNEST_PHONE || '+18413737722'
const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'

// Internal team numbers — never trigger lead flows for these
const TEAM_NUMBERS = new Set([
  '+18167564943', // Casey cell
  '+18163754666', // Casey alt
  '+18166088588', // Ernest cell
  '+18413737722', // Ernest alt
])

/**
 * StatusCallback handler — fires for ALL call status events
 * Logs every inbound call to the CRM, handles missed call flow
 */
export async function POST(req: Request) {
  try {
    const body = await req.formData()
    const from = body.get('From') as string
    const to = body.get('To') as string
    const callStatus = body.get('CallStatus') as string
    const callSid = body.get('CallSid') as string
    const duration = body.get('CallDuration') as string || '0'
    const direction = body.get('Direction') as string || 'inbound'

    if (!from) {
      return new NextResponse('OK', { status: 200 })
    }

    // Skip all lead/auto-text flows for internal team numbers
    if (TEAM_NUMBERS.has(from)) {
      return new NextResponse('OK', { status: 200 })
    }

    // Match caller to existing lead
    const { data: leads } = await supabase
      .from('leads')
      .select('id, full_name, phone')
      .eq('phone', from)
      .limit(1)

    const leadId = leads && leads.length > 0 ? leads[0].id : null
    const leadName = leads && leads.length > 0 ? leads[0].full_name : null

    // Log EVERY inbound call to lead_activities
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'call',
      description: `Inbound call from ${leadName || from} — ${callStatus} (${duration}s)`,
      agent: 'System',
      metadata: {
        direction: 'inbound',
        from,
        to,
        callSid,
        callStatus,
        duration: parseInt(duration),
        matched_lead: leadId ? true : false,
        lead_name: leadName,
      }
    })

    // Ari briefing event for all inbound calls
    if (leadId) {
      await supabase.from('ari_briefing_events').insert({
        event_type: 'inbound_call',
        priority: callStatus === 'completed' ? 'medium' : 'high',
        title: `Inbound call from ${leadName || from} — ${callStatus}`,
        description: `Duration: ${duration}s. Status: ${callStatus}.`,
        lead_id: leadId,
        action_url: `/leads/${leadId}`
      })
    }

    // Missed call specific handling (no-answer or busy)
    if (callStatus === 'no-answer' || callStatus === 'busy') {
      if (leadId && leadName) {
        // Known lead — bump priority, send text-back, create callback
        await supabase.from('leads')
          .update({ priority: 'hot' })
          .eq('id', leadId)

        const firstName = leadName.split(' ')[0] || 'there'
        const smsBody = `Hey ${firstName}, this is Ernest with Saving KC — I just missed your call. I'm available now if you'd like to try again, or I can call you back at a better time.`

        try {
          await twilio.messages.create({ body: smsBody, from: TWILIO_PHONE, to: from })
          await supabase.from('lead_activities').insert({
            lead_id: leadId,
            activity_type: 'sms',
            description: smsBody,
            agent: 'Ari',
            metadata: { direction: 'outbound', from: TWILIO_PHONE, to: from, trigger: 'missed_call_auto' }
          })
        } catch (e) { console.error('Missed call SMS failed:', e) }

        // 5-min callback task
        await supabase.from('lead_activities').insert({
          lead_id: leadId,
          activity_type: 'task',
          description: `Callback: Missed call from ${leadName}`,
          agent: 'Ari',
          metadata: {
            task_type: 'callback',
            due_date: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            assigned_to: 'Casey',
            priority: 'critical',
            status: 'pending',
          }
        })
      } else if (!leadId) {
        // Unknown caller missed call — send generic text
        const unknownSmsBody = `Thanks for calling Saving KC Homebuyers. Were you looking to sell a property? Reply YES and we'll call you right back.`
        try {
          await twilio.messages.create({ body: unknownSmsBody, from: TWILIO_PHONE, to: from })
          await supabase.from('lead_activities').insert({
            lead_id: null,
            activity_type: 'sms',
            description: unknownSmsBody,
            agent: 'Ari',
            metadata: { direction: 'outbound', from: TWILIO_PHONE, to: from, trigger: 'missed_call_unknown' }
          })
        } catch (e) { console.error('Unknown caller text failed:', e) }
      }
    }

    return new NextResponse('OK', { status: 200 })
  } catch (err) {
    console.error('Status callback error:', err)
    return new NextResponse('Error', { status: 500 })
  }
}
