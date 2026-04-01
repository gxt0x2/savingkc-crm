import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { isOptedOut, handleOptOut, handleOptIn, isStopKeyword, isStartKeyword } from '@/lib/sms-opt-out'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import { rateLimit, rateLimitConfigs, getClientIp, phoneRateLimit } from '@/middleware/rate-limit'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
)

const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'
const ERNEST_PHONE = process.env.ERNEST_PHONE || '+18162262552'
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

function isOfficeHours(): boolean {
  const now = new Date()
  const cst = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const hour = cst.getHours()
  return hour >= 9 && hour < 17
}

// Team numbers — never trigger auto-reply flows for these
const TEAM_NUMBERS = new Set([
  '+18167564943', // Casey personal
  '+18167277667', // Casey company
  '+18166088588', // Ernest company
  '+18162262552', // Ernest personal
])

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
    const { data: leads } = await supabase
      .from('leads')
      .select('id, full_name, phone, station, priority')
      .eq('phone', from)
      .limit(1)

    const lead = leads && leads.length > 0 ? leads[0] : null
    const leadId = lead?.id || null
    const leadName = lead?.full_name || 'Unknown'

    // Log the inbound SMS to lead_activities
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'sms',
      description: messageBody,
      agent: 'system',
      metadata: {
        direction: 'received',
        from,
        to,
        message_sid: messageSid,
        lead_name: leadName,
      },
    })

    // ── Skip auto-reply for team numbers ────────────────────
    if (TEAM_NUMBERS.has(from)) {
      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    // ── Keyword detection & auto-reply logic ────────────────
    const msg = messageBody.trim().toUpperCase()

    // ── YES reply (from IVR no-input or missed call text-back) ──
    if (msg === 'YES' || msg === 'YES!' || msg === 'YES PLEASE' || msg === 'Y') {
      let yesLeadId = leadId

      // Create lead if unknown caller
      if (!yesLeadId) {
        const { data: newLead } = await supabase.from('leads').insert({
          full_name: 'Inbound Seller (YES reply)',
          phone: from,
          source: 'sms_yes_reply',
          station: 'intake',
          priority: 'hot',
        }).select('id').single()
        yesLeadId = newLead?.id
      } else {
        // Bump existing lead to hot
        await supabase.from('leads')
          .update({ priority: 'hot' })
          .eq('id', yesLeadId)
      }

      // Alert BOTH agents — primary based on office hours
      const yesAlertBody = `🔥 HOT: ${leadName !== 'Unknown' ? leadName : from} replied YES to sell. Call NOW.${yesLeadId ? ' ' + BASE_URL + '/leads/' + yesLeadId : ''}`
      const primaryAgent = isOfficeHours() ? CASEY_PHONE : ERNEST_PHONE
      const secondaryAgent = isOfficeHours() ? ERNEST_PHONE : CASEY_PHONE
      await Promise.allSettled([
        twilioClient.messages.create({ body: yesAlertBody, from: TWILIO_PHONE, to: primaryAgent }),
        twilioClient.messages.create({ body: yesAlertBody, from: TWILIO_PHONE, to: secondaryAgent }),
      ])

      // Log the alert SMS
      if (yesLeadId) {
        await supabase.from('lead_activities').insert({
          lead_id: yesLeadId,
          activity_type: 'sms',
          description: yesAlertBody,
          agent: 'System',
          metadata: { direction: 'outbound_alert', to_agents: ['Casey', 'Ernest'], trigger: 'yes_reply_alert' },
        }).catch(() => {})
      }

      // Create callback task + Ari briefing event
      const primaryName = isOfficeHours() ? 'Casey' : 'Ernest'
      if (yesLeadId) {
        await supabase.from('lead_activities').insert({
          lead_id: yesLeadId,
          activity_type: 'task',
          description: `URGENT: ${leadName !== 'Unknown' ? leadName : from} replied YES — call back NOW`,
          agent: 'Ari',
          metadata: {
            task_type: 'callback',
            due_date: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            assigned_to: primaryName,
            priority: 'critical',
            status: 'pending',
          },
        })

        await supabase.from('ari_briefing_events').insert({
          event_type: 'yes_reply_seller',
          priority: 'critical',
          title: `🔥 ${leadName !== 'Unknown' ? leadName : from} replied YES — wants to sell`,
          description: `Replied YES to auto-text. Casey notified. Phone: ${from}`,
          lead_id: yesLeadId,
          action_url: `/leads/${yesLeadId}`,
        })
      }

      // Reply to seller
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Perfect! We'll call you right back in just a few minutes. — Saving KC Homebuyers</Message></Response>`,
        { headers: { 'Content-Type': 'text/xml' } }
      )
    }

    // ── STOP / DNC handling (secondary logging — TCPA opt-out already handled above) ──
    if (msg === 'STOP' || msg === 'UNSUBSCRIBE' || msg === 'CANCEL') {
      // Twilio handles STOP automatically at carrier level
      // But log it so we know
      if (leadId) {
        await supabase.from('lead_activities').insert({
          lead_id: leadId,
          activity_type: 'status_change',
          description: `Opt-out received: "${messageBody.trim()}"`,
          agent: 'System',
          metadata: { trigger: 'sms_opt_out', from },
        })
      }
      // Don't reply — Twilio sends its own STOP confirmation
      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    // ── Known hot lead replies (any message = alert BOTH agents) ──
    if (lead && lead.priority === 'hot') {
      const hotAlertBody = `📩 ${leadName} (hot lead) just texted: "${messageBody.slice(0, 100)}" — ${BASE_URL}/leads/${leadId}`
      await Promise.allSettled([
        twilioClient.messages.create({ body: hotAlertBody, from: TWILIO_PHONE, to: CASEY_PHONE }),
        twilioClient.messages.create({ body: hotAlertBody, from: TWILIO_PHONE, to: ERNEST_PHONE }),
      ])
      // Log the alert
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'sms',
        description: hotAlertBody,
        agent: 'System',
        metadata: { direction: 'outbound_alert', to_agents: ['Casey', 'Ernest'], trigger: 'hot_lead_reply_alert' },
      }).catch(() => {})
    }

    // ── Unknown number — create lead so nothing gets lost ──
    if (!lead) {
      const { data: newLead } = await supabase.from('leads').insert({
        full_name: `SMS Lead (${from})`,
        phone: from,
        source: 'inbound_sms',
        station: 'intake',
        priority: 'normal',
      }).select('id').single()

      if (newLead?.id) {
        // Re-link the already-logged SMS to the new lead
        await supabase.from('lead_activities')
          .update({ lead_id: newLead.id })
          .eq('metadata->>message_sid', messageSid)
          .is('lead_id', null)
      }
    }

    // No auto-reply for general messages — keep it human
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    })

  } catch (err) {
    console.error('Twilio SMS webhook error:', err)
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200, // Return 200 so Twilio doesn't retry
      headers: { 'Content-Type': 'text/xml' },
    })
  }
}
