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
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'

/**
 * MCF-01: Caller Identification
 * Checks if caller is: known_lead, skip_trace_match, unknown_clean, or spam
 */
async function identifyCaller(phoneNumber: string): Promise<{
  type: 'known_lead' | 'skip_trace_match' | 'unknown_clean' | 'spam'
  leadId?: string
  leadName?: string
  skipTraceData?: any
}> {
  // Check if caller matches existing lead
  const { data: leads } = await supabase
    .from('leads')
    .select('id, full_name, phone')
    .eq('phone', phoneNumber)
    .limit(1)

  if (leads && leads.length > 0) {
    return {
      type: 'known_lead',
      leadId: leads[0].id,
      leadName: leads[0].full_name,
    }
  }

  // TODO: Check skip trace data (would query skip trace table/API)
  // For now, we'll skip this check

  // Check spam score via Twilio Lookup (if configured)
  try {
    const lookup = await twilio.lookups.v2.phoneNumbers(phoneNumber).fetch()
    const spamScore = lookup.callerName?.error_code === 60200 ? 1.0 : 0.0 // Simplified spam check

    if (spamScore > 0.7) {
      return { type: 'spam' }
    }
  } catch (err) {
    console.log('Twilio Lookup not available or failed, skipping spam check')
  }

  return { type: 'unknown_clean' }
}

/**
 * MCF-02: Known Lead Response
 * Bumps priority, sends personalized SMS, creates callback task
 */
async function handleKnownLead(leadId: string, leadName: string, callerPhone: string) {
  // Bump priority if not already hot
  const { data: lead } = await supabase
    .from('leads')
    .select('priority')
    .eq('id', leadId)
    .single()

  if (lead && lead.priority !== 'hot') {
    await supabase
      .from('leads')
      .update({ priority: 'high' })
      .eq('id', leadId)
  }

  // Send personalized SMS
  const firstName = leadName?.split(' ')[0] || 'there'
  const smsBody = `Hey ${firstName}, this is Ernest with Saving KC — I just missed your call. I'm available now if you'd like to try again, or I can call you back at a better time.`

  try {
    await twilio.messages.create({
      body: smsBody,
      from: TWILIO_PHONE,
      to: callerPhone,
    })

    // Log outbound SMS to lead_activities
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      type: 'sms',
      description: smsBody,
      agent: 'Ari',
      metadata: {
        direction: 'outbound',
        from: TWILIO_PHONE,
        to: callerPhone,
        trigger: 'missed_call_auto_response',
      },
    })
  } catch (err) {
    console.error('Error sending SMS:', err)
  }

  // Create callback task due in 5 minutes
  const callbackTime = new Date()
  callbackTime.setMinutes(callbackTime.getMinutes() + 5)

  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    type: 'callback',
    description: `Callback: Missed call from ${leadName}`,
    agent: 'Ari',
    metadata: {
      title: `Callback: ${leadName}`,
      task_type: 'callback',
      due_date: callbackTime.toISOString(),
      assigned_to: 'ED',
      status: 'pending',
      trigger: 'missed_call',
    },
  })

  // Log the missed call
  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    type: 'call',
    description: 'Missed call - auto-response sent',
    agent: 'System',
    metadata: {
      direction: 'inbound',
      outcome: 'missed',
      from: callerPhone,
      to: TWILIO_PHONE,
    },
  })
}

/**
 * MCF-03: Skip Trace Match Response
 * Creates new lead from skip trace data, sends warm SMS
 */
async function handleSkipTraceMatch(callerPhone: string, skipTraceData: any) {
  // Create new lead from skip trace data
  const { data: newLead, error } = await supabase
    .from('leads')
    .insert({
      full_name: skipTraceData?.name || 'Unknown',
      phone: callerPhone,
      property_address: skipTraceData?.address,
      city: skipTraceData?.city,
      state: skipTraceData?.state,
      zip: skipTraceData?.zip,
      source: 'missed_call_skip_trace_match',
      station: 'not_contacted',
      priority: 'high',
    })
    .select()
    .single()

  if (error || !newLead) {
    console.error('Error creating lead from skip trace:', error)
    return
  }

  // Send warm SMS
  const smsBody = `Hey, I think you may have been trying to reach us about your property. I'd love to chat when you have a moment.`

  try {
    await twilio.messages.create({
      body: smsBody,
      from: TWILIO_PHONE,
      to: callerPhone,
    })

    await supabase.from('lead_activities').insert({
      lead_id: newLead.id,
      type: 'sms',
      description: smsBody,
      agent: 'Ari',
      metadata: {
        direction: 'outbound',
        trigger: 'missed_call_skip_trace_match',
      },
    })
  } catch (err) {
    console.error('Error sending SMS to skip trace match:', err)
  }

  // Create callback task
  const callbackTime = new Date()
  callbackTime.setMinutes(callbackTime.getMinutes() + 10)

  await supabase.from('lead_activities').insert({
    lead_id: newLead.id,
    type: 'callback',
    description: `Callback: New lead from missed call`,
    agent: 'Ari',
    metadata: {
      title: 'Callback: Skip trace match',
      task_type: 'callback',
      due_date: callbackTime.toISOString(),
      assigned_to: 'ED',
      status: 'pending',
    },
  })
}

/**
 * MCF-04: Unknown Caller Response
 * Sends generic SMS for manual review
 */
async function handleUnknownCaller(callerPhone: string) {
  const smsBody = `Thanks for calling Saving KC Homebuyers. Were you looking to sell a property?`

  try {
    await twilio.messages.create({
      body: smsBody,
      from: TWILIO_PHONE,
      to: callerPhone,
    })

    // Log for manual review
    await supabase.from('lead_activities').insert({
      lead_id: null,
      type: 'call',
      description: `Unknown missed call from ${callerPhone}`,
      agent: 'System',
      metadata: {
        direction: 'inbound',
        outcome: 'missed_unknown',
        from: callerPhone,
        sms_sent: smsBody,
        needs_review: true,
      },
    })
  } catch (err) {
    console.error('Error handling unknown caller:', err)
  }
}

/**
 * MCF-05: Spam Handling
 * Logs spam call, no response sent
 */
async function handleSpam(callerPhone: string) {
  // Log spam call
  await supabase.from('lead_activities').insert({
    lead_id: null,
    type: 'call',
    description: `Spam call blocked from ${callerPhone}`,
    agent: 'System',
    metadata: {
      direction: 'inbound',
      outcome: 'spam_blocked',
      from: callerPhone,
      spam_score: 1.0,
    },
  })

  // Check if this number has been flagged 3+ times
  const { data: spamCalls } = await supabase
    .from('lead_activities')
    .select('id')
    .is('lead_id', null)
    .eq('type', 'call')
    .contains('metadata', { from: callerPhone, outcome: 'spam_blocked' })

  if (spamCalls && spamCalls.length >= 3) {
    console.log(`Phone ${callerPhone} flagged as spam 3+ times - consider adding to block list`)
  }
}

/**
 * Twilio Missed Call Webhook Handler
 * Main entry point for missed call flow
 */
export async function POST(req: Request) {
  try {
    const body = await req.formData()
    const from = body.get('From') as string
    const to = body.get('To') as string
    const callStatus = body.get('CallStatus') as string

    if (!from || callStatus !== 'no-answer') {
      return new NextResponse('Not a missed call', { status: 200 })
    }

    // MCF-01: Identify caller
    const caller = await identifyCaller(from)

    // Route based on caller type
    switch (caller.type) {
      case 'known_lead':
        // MCF-02
        if (caller.leadId && caller.leadName) {
          await handleKnownLead(caller.leadId, caller.leadName, from)
        }
        break

      case 'skip_trace_match':
        // MCF-03
        await handleSkipTraceMatch(from, caller.skipTraceData)
        break

      case 'unknown_clean':
        // MCF-04
        await handleUnknownCaller(from)
        break

      case 'spam':
        // MCF-05
        await handleSpam(from)
        break
    }

    // Return empty TwiML
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
</Response>`

    return new NextResponse(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (err) {
    console.error('Missed call webhook error:', err)
    return new NextResponse('Internal server error', { status: 500 })
  }
}
