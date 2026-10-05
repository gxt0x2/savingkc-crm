import { NextResponse } from 'next/server'
import { getAgentRouting } from '@/lib/agent-routing'
import { buildCarrierVoiceFallbackTwiml } from '@/lib/telephony/carrier-fallback'
import { directInboundClientIdentity } from '@/lib/telephony/direct-inbound-ring'
import { lookupInboundCallerName } from '@/lib/telephony/inbound-caller-name'
import { validateTwilioWebhook } from '@/lib/twilio-validate'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const XML_HEADERS = {
  'Content-Type': 'text/xml',
  'Cache-Control': 'no-store, max-age=0',
}

export async function POST(request: Request) {
  if (!await validateTwilioWebhook(request)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const body = await request.formData()
  const from = String(body.get('From') || '')
  const calledNumber = String(body.get('To') || '')
  if (!from || !calledNumber) {
    return new NextResponse('Missing From or To', { status: 400 })
  }

  const routing = getAgentRouting(calledNumber)
  let callerName = ''
  if (directInboundClientIdentity(calledNumber)) {
    try {
      callerName = await lookupInboundCallerName(from)
    } catch {
      console.error('[IVR] Inbound caller name lookup failed')
    }
  }
  return new NextResponse(buildCarrierVoiceFallbackTwiml({
    from,
    calledNumber,
    agentPhone: routing.primary.phone,
    callerName,
  }), { headers: XML_HEADERS })
}
