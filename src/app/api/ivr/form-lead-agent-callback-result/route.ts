import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const XML_HEADERS: HeadersInit = {
  'Content-Type': 'text/xml',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
}

function xmlResponse(body: string, status = 200) {
  return new NextResponse(body, { status, headers: XML_HEADERS })
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const leadId = url.searchParams.get('leadId') || ''
    const leadPhone = url.searchParams.get('leadPhone') || ''
    const callerId = url.searchParams.get('callerId') || ''
    const trigger = url.searchParams.get('trigger') || 'ppc_form_submit'
    const batchId = url.searchParams.get('batchId') || ''
    const agentName = url.searchParams.get('agentName') || 'Agent'
    const agentPhone = url.searchParams.get('agentPhone') || ''
    const callbackSource = trigger.startsWith('ppc_') ? 'ppc_form_agent_callback' : 'lead_form_agent_callback'

    const body = await req.formData()
    const dialStatus = body.get('DialCallStatus')?.toString() || ''
    const dialCallSid = body.get('DialCallSid')?.toString() || ''
    const dialCallDuration = body.get('DialCallDuration')?.toString() || ''
    const connected = dialStatus === 'completed'

    if (leadId) {
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'call',
        description: connected
          ? `${callbackSource === 'ppc_form_agent_callback' ? 'PPC' : 'Lead'} form agent-assisted callback connected with seller`
          : `${callbackSource === 'ppc_form_agent_callback' ? 'PPC' : 'Lead'} form seller did not answer agent-assisted callback`,
        agent: 'System',
        metadata: {
          source: callbackSource,
          trigger,
          outcome: connected ? 'connected' : 'missed',
          direction: 'outbound',
          to: leadPhone,
          callerId,
          batchId,
          agentName,
          agentPhone,
          dialStatus,
          dialCallSid,
          dialCallDuration,
        },
      })
    }

    if (connected) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`)
    }

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">The seller did not answer. Goodbye.</Say>
  <Hangup/>
</Response>`)
  } catch (error) {
    console.error('[IVR/form-lead-agent-callback-result] Error:', error)
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`, 500)
  }
}
