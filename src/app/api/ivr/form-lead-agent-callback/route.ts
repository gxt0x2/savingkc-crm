import { NextResponse } from 'next/server'
import { buildFormLeadCallbackIntro } from '@/lib/lead-form-callback'
import { supabase } from '@/lib/supabase-lazy'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

const XML_HEADERS: HeadersInit = {
  'Content-Type': 'text/xml',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
}

function xmlResponse(body: string, status = 200) {
  return new NextResponse(body, { status, headers: XML_HEADERS })
}

function escParam(value: string): string {
  return encodeURIComponent(value || '')
}

function escXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

async function claimCallbackBatch(input: {
  leadId: string
  batchId: string
  leadPhone: string
  callerId: string
  agentName: string
  agentPhone: string
  trigger: string
  agentCallSid: string
  source: string
}): Promise<{ claimed: boolean; winnerAgent?: string }> {
  if (!input.leadId || !input.batchId) return { claimed: true }

  const claimMetadata = {
    source: input.source,
    batch_id: input.batchId,
    outcome: 'agent_claimed',
    trigger: input.trigger,
    agentName: input.agentName,
    agentPhone: input.agentPhone,
    agentCallSid: input.agentCallSid,
    callerId: input.callerId,
    to: input.leadPhone,
  }

  const { data: claim, error: claimError } = await supabase
    .from('lead_activities')
    .insert({
      lead_id: input.leadId,
      activity_type: 'call',
      description: `${input.source === 'ppc_form_agent_callback' ? 'PPC' : 'Lead'} form callback claimed by ${input.agentName}`,
      agent: 'System',
      metadata: claimMetadata,
    })
    .select('id,created_at')
    .single()

  if (claimError || !claim?.id) {
    console.error('[IVR/form-lead-agent-callback] claim insert failed:', claimError)
    return { claimed: true }
  }

  const claimWindow = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const { data: claims, error: claimsError } = await supabase
    .from('lead_activities')
    .select('id,metadata,created_at')
    .eq('lead_id', input.leadId)
    .eq('activity_type', 'call')
    .gte('created_at', claimWindow)
    .contains('metadata', {
      source: input.source,
      batch_id: input.batchId,
      outcome: 'agent_claimed',
    })
    .order('created_at', { ascending: true })
    .limit(10)

  if (claimsError || !claims?.length) {
    console.error('[IVR/form-lead-agent-callback] claim lookup failed:', claimsError)
    return { claimed: true }
  }

  const winner = claims[0]
  return {
    claimed: winner.id === claim.id,
    winnerAgent: typeof winner.metadata?.agentName === 'string' ? winner.metadata.agentName : undefined,
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const leadId = url.searchParams.get('leadId') || ''
  const leadPhone = url.searchParams.get('leadPhone') || ''
  const callerId = url.searchParams.get('callerId') || process.env.TWILIO_PHONE_NUMBER || ''
  const fullName = url.searchParams.get('fullName') || ''
  const address = url.searchParams.get('address') || ''
  const city = url.searchParams.get('city') || ''
  const trigger = url.searchParams.get('trigger') || 'ppc_form_submit'
  const callbackSource = trigger.startsWith('ppc_') ? 'ppc_form_agent_callback' : 'lead_form_agent_callback'
  const batchId = url.searchParams.get('batchId') || ''
  const agentName = url.searchParams.get('agentName') || 'Agent'
  const agentPhone = url.searchParams.get('agentPhone') || ''
  const form = await req.formData().catch(() => null)
  const agentCallSid = form?.get('CallSid')?.toString() || ''

  if (!leadPhone || !callerId) {
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Form lead callback failed. No lead phone number was available.</Say>
  <Hangup/>
</Response>`)
  }

  const claim = await claimCallbackBatch({
    leadId,
    batchId,
    leadPhone,
    callerId,
    agentName,
    agentPhone,
    trigger,
    agentCallSid,
    source: callbackSource,
  })

  if (!claim.claimed) {
    const winner = claim.winnerAgent || 'another teammate'
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">This lead was already picked up by ${escXml(winner)}. Goodbye.</Say>
  <Hangup/>
</Response>`)
  }

  const intro = buildFormLeadCallbackIntro({ fullName, address, city })
  const resultAction = `${BASE_URL}/api/ivr/form-lead-agent-callback-result?leadId=${escParam(leadId)}&amp;leadPhone=${escParam(leadPhone)}&amp;callerId=${escParam(callerId)}&amp;trigger=${escParam(trigger)}&amp;batchId=${escParam(batchId)}&amp;agentName=${escParam(agentName)}&amp;agentPhone=${escParam(agentPhone)}`
  const recordingCallback = `${BASE_URL}/api/twilio-recording-callback?source=${escParam(callbackSource)}&amp;from=${escParam(leadPhone)}&amp;leadId=${escParam(leadId)}&amp;calledNumber=${escParam(callerId)}`
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escXml(intro)}</Say>
  <Dial action="${resultAction}" method="POST" timeout="20" callerId="${escXml(callerId)}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${recordingCallback}" recordingStatusCallbackMethod="POST">
    <Number>${escXml(leadPhone)}</Number>
  </Dial>
</Response>`

  return xmlResponse(twiml)
}
