import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isOptedOut } from '@/lib/sms-opt-out'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import { rateLimit, rateLimitConfigs, getClientIp, phoneRateLimit } from '@/middleware/rate-limit'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'

// Internal team numbers — never send auto-texts to these
const TEAM_NUMBERS = new Set([
  '+18167564943', // Casey personal
  '+18167277667', // Casey company
  '+18166088588', // Ernest company
  '+18162262552', // Ernest personal
])

export async function POST(req: Request) {
  const url = new URL(req.url)

  // Twilio signature validation
  const isValid = await validateTwilioWebhook(req)
  if (!isValid) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // IP-based rate limiting
  const ip = getClientIp(req)
  const { allowed: ipAllowed } = rateLimit(ip, rateLimitConfigs.webhook)
  if (!ipAllowed) {
    return new NextResponse('Rate limited', { status: 429 })
  }

  const from = url.searchParams.get('from') || ''
  const calledNumber = url.searchParams.get('calledNumber') || TWILIO_PHONE

  if (from && !from.includes('anonymous') && !from.includes('blocked') && !TEAM_NUMBERS.has(from)) {
    // Find or create lead so the call isn't orphaned
    let noInputLeadId: string | null = null
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', from)
      .limit(1)
      .single()

    if (existingLead?.id) {
      noInputLeadId = existingLead.id
    } else {
      const { data: newLead } = await supabase.from('leads').insert({
        full_name: `Caller (${from})`,
        phone: from,
        source: 'inbound_ivr_no_input',
        station: 'intake',
        priority: 'normal',
      }).select('id').single()
      noInputLeadId = newLead?.id || null
    }

    // Log the original inbound call (was missing before)
    await supabase.from('lead_activities').insert({
      lead_id: noInputLeadId,
      activity_type: 'call',
      description: `Inbound call from ${from} — no IVR input, auto-text sent`,
      agent: 'System',
      metadata: { direction: 'inbound', from, tag: 'ivr_no_input' }
    })

    // Send text-back
    const optedOut = await isOptedOut(from)
    const { allowed: phoneAllowed } = phoneRateLimit(from)
    if (!optedOut && phoneAllowed) {
      const msg = `Thanks for calling Saving KC Homebuyers. Were you looking to sell a property? Reply YES and we'll call you right back.`
      try {
        await twilio.messages.create({ body: msg, from: calledNumber, to: from })
        await supabase.from('lead_activities').insert({
          lead_id: noInputLeadId,
          activity_type: 'sms',
          description: msg,
          agent: 'System',
          metadata: { direction: 'outbound', to: from, trigger: 'ivr_no_input', awaiting_yes_reply: true }
        })
      } catch (e) { console.error('No-input text-back failed:', e) }
    }

    // Alert agents about missed IVR caller
    const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'
    const ERNEST_PHONE = process.env.ERNEST_PHONE || '+18162262552'
    const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'
    const noInputAlert = `📞 Inbound call from ${from} — no IVR input. Auto-text sent.${noInputLeadId ? ' ' + BASE_URL + '/leads/' + noInputLeadId : ''}`
    await Promise.allSettled([
      twilio.messages.create({ body: noInputAlert, from: calledNumber, to: CASEY_PHONE }),
      twilio.messages.create({ body: noInputAlert, from: calledNumber, to: ERNEST_PHONE }),
    ])

    // Ari briefing event
    if (noInputLeadId) {
      try {
        await supabase.from('ari_briefing_events').insert({
          event_type: 'ivr_no_input',
          priority: 'medium',
          title: `Inbound call — no IVR input: ${from}`,
          description: `Caller didn't press any option. Auto-text sent. Watch for YES reply.`,
          lead_id: noInputLeadId,
          action_url: `/leads/${noInputLeadId}`,
        })
      } catch {}
    }
  }

  return new NextResponse('<Response><Hangup /></Response>', { headers: { 'Content-Type': 'text/xml' } })
}
