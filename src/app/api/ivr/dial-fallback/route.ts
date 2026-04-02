import { NextResponse } from 'next/server'
import { getAgentRouting } from '@/lib/agent-routing'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

// Handles Press 2 (non-seller) dial result — cascades to voicemail if nobody answers
export async function POST(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || ''
  const leadId = url.searchParams.get('leadId') || ''
  const calledNumber = url.searchParams.get('calledNumber') || ''

  const body = await req.formData()
  const dialStatus = body.get('DialCallStatus') as string

  if (dialStatus === 'completed') {
    return new NextResponse('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
  }

  // Nobody answered — route to primary agent's voicemail
  const routing = getAgentRouting(calledNumber)
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${BASE_URL}/api/ivr/voicemail?agent=${encodeURIComponent(routing.primary.name)}&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(leadId)}</Redirect>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
