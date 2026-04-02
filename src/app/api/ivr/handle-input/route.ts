import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAgentRouting } from '@/lib/agent-routing'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

export async function POST(req: Request) {
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
        await supabase.from('leads').update({ priority: 'hot' }).eq('id', leadId)
      } else {
        const { data: newLead } = await supabase.from('leads').insert({
          full_name: isColdCall ? `Cold Callback (${from})` : 'Inbound Seller',
          phone: from,
          source,
          station: 'intake',
          priority: 'hot',
        }).select('id').single()
        leadId = newLead?.id || ''
      }

      await supabase.from('lead_activities').insert({
        lead_id: leadId || null,
        activity_type: 'call',
        description: isColdCall
          ? `Cold call callback from ${from} — pressed 1, wants to sell`
          : `Inbound seller call from ${from} — pressed 1`,
        agent: 'System',
        metadata: { direction: 'inbound', from, callSid, source: isColdCall ? 'cold_callback_press_1' : 'ivr_press_1' }
      })
    }

    // Sim-ring both agents — first to answer gets connected
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${BASE_URL}/api/ivr/dial-result?from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(leadId)}&amp;calledNumber=${encodeURIComponent(calledNumber)}&amp;type=seller" method="POST" timeout="20" callerId="${routing.primary.companyNumber}">
    <Number url="${BASE_URL}/api/ivr/whisper?type=seller&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(leadId)}">${routing.primary.phone}</Number>
    <Number url="${BASE_URL}/api/ivr/whisper?type=seller&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(leadId)}">${routing.secondary.phone}</Number>
  </Dial>
</Response>`
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
        description: `Inbound call (Press 2 — non-seller inquiry) from ${from}`,
        agent: 'System',
        metadata: { direction: 'inbound', from, callSid, tag: 'non_lead_inquiry' }
      })
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${BASE_URL}/api/ivr/dial-result?from=${encodeURIComponent(from)}&amp;leadId=&amp;calledNumber=${encodeURIComponent(calledNumber)}&amp;type=non_seller" method="POST" timeout="20" callerId="${routing.primary.companyNumber}">
    <Number url="${BASE_URL}/api/ivr/whisper?type=non_seller&amp;from=${encodeURIComponent(from)}">${routing.primary.phone}</Number>
    <Number url="${BASE_URL}/api/ivr/whisper?type=non_seller&amp;from=${encodeURIComponent(from)}">${routing.secondary.phone}</Number>
  </Dial>
</Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // Invalid input — cold callbacks go to auto-text, standard IVR replays greeting
  if (isColdCall) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${BASE_URL}/api/ivr/cold-no-input?from=${encodeURIComponent(from)}&amp;calledNumber=${encodeURIComponent(calledNumber)}</Redirect>
</Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${BASE_URL}/api/twiml-voice</Redirect>
</Response>`
  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
