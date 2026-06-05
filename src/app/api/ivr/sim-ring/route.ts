import { NextResponse } from 'next/server'
import { getAgentRouting } from '@/lib/agent-routing'
import { getLeadAlertRecipients } from '@/lib/lead-alert-routing'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

export async function POST(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || ''
  const leadId = url.searchParams.get('leadId') || ''
  const calledNumber = url.searchParams.get('calledNumber') || ''
  const type = url.searchParams.get('type') || 'seller'

  const routing = getAgentRouting(calledNumber)
  const recipients = getLeadAlertRecipients()
  const dialRecipients = recipients.length > 0
    ? recipients
    : [{ name: routing.primary.name, phone: routing.primary.phone }]

  // Simultaneous ring eligible lead-alert agents — first to answer gets connected.
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${BASE_URL}/api/ivr/dial-result?from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(leadId)}&amp;calledNumber=${encodeURIComponent(calledNumber)}&amp;type=${encodeURIComponent(type)}" method="POST" timeout="20" callerId="${routing.primary.companyNumber}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${BASE_URL}/api/twilio-recording-callback" recordingStatusCallbackMethod="POST">
    ${dialRecipients.map((recipient) => `<Number url="${BASE_URL}/api/ivr/whisper?type=${encodeURIComponent(type)}&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(leadId)}&amp;agent=${encodeURIComponent(recipient.name)}">${recipient.phone}</Number>`).join('\n    ')}
  </Dial>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
