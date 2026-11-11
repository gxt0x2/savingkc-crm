import { NextResponse } from 'next/server'
import { getAgentRouting } from '@/lib/agent-routing'
import { formatPhone } from '@/lib/format'
import { agentDialTwiml, businessMenuTwiml, optOutTwiml } from '@/lib/telephony/business-line-ivr'
import { handleOptOut } from '@/lib/sms-opt-out'
import { supabase } from '@/lib/supabase-lazy'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import { queueInboundLeadAttribution } from '@/lib/server/inbound-lead-attribution'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'
const INVALID_TWILIO_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>'

function invalidTwilioResponse() {
  return new NextResponse(INVALID_TWILIO_TWIML, {
    status: 403,
    headers: { 'Content-Type': 'text/xml', 'Cache-Control': 'no-store' },
  })
}

export async function POST(req: Request) {
  try {
    if (!(await validateTwilioWebhook(req))) return invalidTwilioResponse()
  } catch (error) {
    console.error('[IVR/handle-input] Twilio signature validation failed:', error)
    return invalidTwilioResponse()
  }

  try {
    const url = new URL(req.url)
    const from = url.searchParams.get('from') || ''
    const callSid = url.searchParams.get('callSid') || ''
    const calledNumber = url.searchParams.get('calledNumber') || ''
    const isColdCall = url.searchParams.get('coldcall') === '1'

    const body = await req.formData()
    const digit = body.get('Digits') as string

    const routing = getAgentRouting(calledNumber)

  if (digit === '1') {
    // PRESS 1 — SELLER: Find/create lead, then sim-ring both agents
    let leadId = ''
    const source = isColdCall ? 'cold_call_callback' : 'inbound_ivr'
    if (from) {
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', from)
        .limit(1)
        .single()

      if (existingLead?.id) {
        leadId = existingLead.id
        const { error: priorityError } = await supabase.from('leads').update({ priority: 'hot' }).eq('id', leadId)
        if (priorityError) throw priorityError
      } else {
        // Check prospects before creating bare lead
        const { lookupProspectByPhone } = await import('@/lib/prospect-lookup')
        const { createEnrichedLeadFromProspect } = await import('@/lib/prospect-to-lead')

        const prospectMatches = await lookupProspectByPhone(from)
        if (prospectMatches.length > 0) {
          const createdId = await createEnrichedLeadFromProspect(
            prospectMatches[0],
            from,
            isColdCall ? 'cold_call_callback' : 'inbound_ivr',
            'hot'
          )
          if (createdId) leadId = createdId
        }

        // If no prospect match, create bare lead
        if (!leadId) {
          const { data: newLead } = await supabase.from('leads').insert({
            full_name: isColdCall ? `Cold Callback ${formatPhone(from) || from}` : 'Inbound Seller',
            phone: from,
            source,
            station: 'new',
            priority: 'hot',
          }).select('id').single()
          leadId = newLead?.id || ''
        }
      }

      queueInboundLeadAttribution({ leadId, channel: 'call', callerNumber: from, calledNumber, callSid })

      await supabase.from('lead_activities').insert({
        lead_id: leadId || null,
        activity_type: 'call',
        description: isColdCall
          ? `Cold call callback from ${formatPhone(from)} — pressed 1, wants to sell`
          : `Inbound seller call from ${formatPhone(from)} — pressed 1`,
        agent: 'System',
        metadata: { direction: 'inbound', from, callSid, source: isColdCall ? 'cold_callback_press_1' : 'ivr_press_1' }
      })

    }

    // Sim-ring both agents (apps and cells) — first to answer gets connected
    const twiml = agentDialTwiml({
      baseUrl: BASE_URL,
      from,
      calledNumber,
      companyNumber: routing.primary.companyNumber,
      leadId,
      type: 'seller',
      cells: [routing.primary.phone, routing.secondary.phone],
      ringApps: !isColdCall,
      announce: !isColdCall,
    })
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  if (digit === '2') {
    // Cold call callback press 2 = not interested, auto-text + hangup
    if (isColdCall) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${BASE_URL}/api/ivr/cold-no-input?from=${encodeURIComponent(from)}&amp;calledNumber=${encodeURIComponent(calledNumber)}</Redirect>
</Response>`
      return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
    }

    // PRESS 2 — NON-SELLER: Do NOT create a lead. Just log and dial agents.
    if (from) {
      await supabase.from('lead_activities').insert({
        lead_id: null,
        activity_type: 'call',
        description: `Inbound call (Press 2 — non-seller inquiry) from ${formatPhone(from)}`,
        agent: 'System',
        metadata: { direction: 'inbound', from, callSid, tag: 'non_lead_inquiry' }
      })
    }

    const twiml = agentDialTwiml({
      baseUrl: BASE_URL,
      from,
      calledNumber,
      companyNumber: routing.primary.companyNumber,
      leadId: '',
      type: 'non_seller',
      cells: [routing.primary.phone, routing.secondary.phone],
      ringApps: true,
      announce: true,
    })
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // PRESS 9 — menu lines: do not call or text this number again (owner 11/07).
  if (digit === '9' && !isColdCall && from) {
    try {
      await handleOptOut(from, 'DNC')
      await supabase.from('lead_activities').insert({
        lead_id: null,
        activity_type: 'call',
        description: `Caller ${formatPhone(from)} pressed 9: added to do-not-call (calls and texts)`,
        agent: 'System',
        metadata: { direction: 'inbound', from, callSid, calledNumber, source: 'ivr_press_9', outcome: 'opt_out' },
      })
    } catch (error) {
      console.error('[IVR/handle-input] press 9 opt-out was not saved', error)
    }
    return new NextResponse(optOutTwiml(), { headers: { 'Content-Type': 'text/xml' } })
  }

  // Invalid input — cold callbacks go to auto-text, menu lines get one
  // shorter retry (never the 15 s ring again)
  if (!isColdCall) {
    return new NextResponse(businessMenuTwiml({ baseUrl: BASE_URL, from, callSid, calledNumber, attempt: 2 }), { headers: { 'Content-Type': 'text/xml' } })
  }
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${BASE_URL}/api/ivr/cold-no-input?from=${encodeURIComponent(from)}&amp;calledNumber=${encodeURIComponent(calledNumber)}</Redirect>
</Response>`
  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  } catch (error) {
    console.error('[IVR/handle-input] Critical error:', error)
    // Emergency fallback: ring both agents
    const emergencyTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="15">
    <Number>+18162262552</Number>
    <Number>+18167564943</Number>
  </Dial>
</Response>`
    return new NextResponse(emergencyTwiml, { headers: { 'Content-Type': 'text/xml' } })
  }
}
