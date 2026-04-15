import { NextResponse } from 'next/server'
import { getAgentRouting } from '@/lib/agent-routing'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

export async function POST(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || ''
  const leadId = url.searchParams.get('leadId') || ''
  const calledNumber = url.searchParams.get('calledNumber') || ''
  const type = url.searchParams.get('type') || 'seller'

  const routing = getAgentRouting(calledNumber)

  // Simultaneous ring both agents — first to answer gets connected
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${BASE_URL}/api/ivr/dial-result?from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(leadId)}&amp;calledNumber=${encodeURIComponent(calledNumber)}&amp;type=${encodeURIComponent(type)}" method="POST" timeout="20" callerId="${routing.primary.companyNumber}" record="record-from-answer-dual" recordingStatusCallback="${BASE_URL}/api/twilio-recording-callback" recordingStatusCallbackMethod="POST">
    <Number url="${BASE_URL}/api/ivr/whisper?type=${encodeURIComponent(type)}&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(leadId)}">${routing.primary.phone}</Number>
    <Number url="${BASE_URL}/api/ivr/whisper?type=${encodeURIComponent(type)}&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(leadId)}">${routing.secondary.phone}</Number>
  </Dial>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
