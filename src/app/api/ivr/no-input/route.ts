import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isOptedOut } from '@/lib/sms-opt-out'
import { rateLimit, rateLimitConfigs, getClientIp, phoneRateLimit } from '@/middleware/rate-limit'
import { getAgentRouting } from '@/lib/agent-routing'
import { isDuplicateSms, logSmsSend } from '@/lib/sms-dedup'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

function sendDelayed(fn: () => Promise<void>, minSec: number, maxSec: number) {
  const delay = (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000
  setTimeout(() => fn().catch(e => console.error('Delayed send failed:', e)), delay)
}

const TEAM_NUMBERS = new Set([
  '+18167564943', '+18167277667', '+18166088588', '+18162262552',
])

/**
 * Spam check: count how many no-input calls this number made in the last 7 days.
 * 3+ = likely robocall/spam. Skip lead creation, auto-text, and agent alerts.
 */
async function isLikelySpam(phone: string): Promise<boolean> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('lead_activities')
    .select('id', { count: 'exact', head: true })
    .eq('metadata->>tag', 'ivr_no_input')
    .eq('metadata->>from', phone)
    .gte('created_at', sevenDaysAgo)

  return (count ?? 0) >= 3
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || ''
  const calledNumber = url.searchParams.get('calledNumber') || TWILIO_PHONE

  const routing = getAgentRouting(calledNumber)

  if (from && !from.includes('anonymous') && !from.includes('blocked') && !TEAM_NUMBERS.has(from)) {

    // Spam detection: 3+ no-input calls in 7 days = silently hang up
    const spam = await isLikelySpam(from)
    if (spam) {
      // Still log it for auditing, but don't create leads or bother agents
      await supabase.from('lead_activities').insert({
        lead_id: null,
        activity_type: 'call',
        description: `Spam filtered: repeat no-input caller ${from} (3+ in 7 days)`,
        agent: 'System',
        metadata: { direction: 'inbound', from, tag: 'ivr_no_input', spam: true }
      })
      return new NextResponse('<Response><Hangup /></Response>', { headers: { 'Content-Type': 'text/xml' } })
    }

    // Find or create lead (dedup by phone)
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

    // Log the inbound call (also feeds the spam counter for future calls)
    await supabase.from('lead_activities').insert({
      lead_id: noInputLeadId,
      activity_type: 'call',
      description: `Inbound call from ${from} — no IVR input, routing to agents`,
      agent: 'System',
      metadata: { direction: 'inbound', from, tag: 'ivr_no_input' }
    })

    // Send auto-text as backup (delayed, with dedup)
    const optedOut = await isOptedOut(from)
    const { allowed: phoneAllowed } = phoneRateLimit(from)
    if (!optedOut && phoneAllowed) {
      const msg = `Thanks for calling Saving KC Homebuyers. Were you looking to sell a property? Reply YES and we'll call you right back.`
      const isDupe = await isDuplicateSms(from, msg)
      if (!isDupe) {
        sendDelayed(async () => {
          await twilio.messages.create({ body: msg, from: calledNumber, to: from })
          await logSmsSend(from, msg, calledNumber, noInputLeadId || undefined)
          await supabase.from('lead_activities').insert({
            lead_id: noInputLeadId,
            activity_type: 'sms',
            description: msg,
            agent: 'System',
            metadata: { direction: 'outbound', to: from, trigger: 'ivr_no_input', awaiting_yes_reply: true }
          })
        }, 45, 90)
      }
    }

    // Alert agents
    const noInputAlert = `Inbound call from ${from} — no IVR input. Routing to agents now.${noInputLeadId ? ' ' + BASE_URL + '/leads/' + noInputLeadId : ''}`
    await Promise.allSettled([
      twilio.messages.create({ body: noInputAlert, from: calledNumber, to: routing.primary.phone }),
      twilio.messages.create({ body: noInputAlert, from: calledNumber, to: routing.secondary.phone }),
    ])

    // Ari briefing event
    if (noInputLeadId) {
      try {
        await supabase.from('ari_briefing_events').insert({
          event_type: 'ivr_no_input',
          priority: 'medium',
          title: `Inbound call — no IVR input: ${from}`,
          description: `Caller didn't press any option. Routing to agents. Auto-text sent as backup.`,
          lead_id: noInputLeadId,
          action_url: `/leads/${noInputLeadId}`,
        })
      } catch {}
    }

    // Dial both agents instead of hanging up
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${BASE_URL}/api/ivr/dial-result?from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(noInputLeadId || '')}&amp;calledNumber=${encodeURIComponent(calledNumber)}&amp;type=no_input" method="POST" timeout="20" callerId="${routing.primary.companyNumber}">
    <Number url="${BASE_URL}/api/ivr/whisper?type=call&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(noInputLeadId || '')}">${routing.primary.phone}</Number>
    <Number url="${BASE_URL}/api/ivr/whisper?type=call&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(noInputLeadId || '')}">${routing.secondary.phone}</Number>
  </Dial>
</Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // Anonymous/blocked/team caller — just hang up
  return new NextResponse('<Response><Hangup /></Response>', { headers: { 'Content-Type': 'text/xml' } })
}
