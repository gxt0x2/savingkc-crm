import { NextResponse } from 'next/server'
import { GOOGLE_ADS_PHONE_NUMBER } from '@/lib/call-quality-events'
import { callerPhoneLabel } from '@/lib/google-ads-phone'

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

function esc(value: string): string {
  return encodeURIComponent(value || '')
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const leadId = url.searchParams.get('leadId') || ''
  const leadPhone = url.searchParams.get('leadPhone') || ''
  const calledNumber = url.searchParams.get('calledNumber') || GOOGLE_ADS_PHONE_NUMBER
  const agentName = url.searchParams.get('agentName') || 'agent'
  const triggerCallSid = url.searchParams.get('triggerCallSid') || ''

  if (!leadPhone) {
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Google Ads callback failed. No lead phone number was available.</Say>
  <Hangup/>
</Response>`)
  }

  const resultAction = `${BASE_URL}/api/ivr/google-ads-agent-callback-result?leadId=${esc(leadId)}&amp;leadPhone=${esc(leadPhone)}&amp;calledNumber=${esc(calledNumber)}&amp;agentName=${esc(agentName)}&amp;triggerCallSid=${esc(triggerCallSid)}`
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Google Ads lead callback. Calling ${callerPhoneLabel(leadPhone)} now.</Say>
  <Dial action="${resultAction}" method="POST" timeout="20" callerId="${calledNumber}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${BASE_URL}/api/twilio-recording-callback" recordingStatusCallbackMethod="POST">
    <Number>${leadPhone}</Number>
  </Dial>
</Response>`

  return xmlResponse(twiml)
}
