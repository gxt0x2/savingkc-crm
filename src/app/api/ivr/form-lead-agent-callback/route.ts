import { NextResponse } from 'next/server'
import { buildFormLeadCallbackIntro } from '@/lib/lead-form-callback'

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

export async function POST(req: Request) {
  const url = new URL(req.url)
  const leadId = url.searchParams.get('leadId') || ''
  const leadPhone = url.searchParams.get('leadPhone') || ''
  const callerId = url.searchParams.get('callerId') || process.env.TWILIO_PHONE_NUMBER || ''
  const fullName = url.searchParams.get('fullName') || ''
  const address = url.searchParams.get('address') || ''
  const city = url.searchParams.get('city') || ''
  const trigger = url.searchParams.get('trigger') || 'ppc_form_submit'

  if (!leadPhone || !callerId) {
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Form lead callback failed. No lead phone number was available.</Say>
  <Hangup/>
</Response>`)
  }

  const intro = buildFormLeadCallbackIntro({ fullName, address, city })
  const resultAction = `${BASE_URL}/api/ivr/form-lead-agent-callback-result?leadId=${escParam(leadId)}&amp;leadPhone=${escParam(leadPhone)}&amp;callerId=${escParam(callerId)}&amp;trigger=${escParam(trigger)}`
  const recordingCallback = `${BASE_URL}/api/twilio-recording-callback?source=ppc_form_agent_callback&amp;from=${escParam(leadPhone)}&amp;leadId=${escParam(leadId)}&amp;calledNumber=${escParam(callerId)}`
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escXml(intro)}</Say>
  <Dial action="${resultAction}" method="POST" timeout="20" callerId="${escXml(callerId)}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${recordingCallback}" recordingStatusCallbackMethod="POST">
    <Number>${escXml(leadPhone)}</Number>
  </Dial>
</Response>`

  return xmlResponse(twiml)
}
