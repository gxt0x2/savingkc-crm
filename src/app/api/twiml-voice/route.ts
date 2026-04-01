import { NextResponse } from 'next/server'

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

export async function POST(req: Request) {
  const body = await req.formData()
  const callSid = body.get('CallSid') as string
  const from = body.get('From') as string
  const to = body.get('To') as string

  // ── OUTBOUND: browser/SDK-initiated call ──
  // When device.connect() is called from telephony bar, From starts with "client:"
  if (from && from.startsWith('client:')) {
    const sanitizedTo = to ? to.replace(/[^\d+]/g, '') : ''
    if (!sanitizedTo) {
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>No destination number provided.</Say></Response>`
      return new NextResponse(errorTwiml, { headers: { 'Content-Type': 'text/xml' } })
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${TWILIO_PHONE}" timeout="15" record="record-from-answer-dual">
    <Number>${sanitizedTo}</Number>
  </Dial>
</Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // ── INBOUND: ring for ~12 seconds, then IVR ──
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${BASE_URL}/audio/us-ringback.wav</Play>
  <Gather numDigits="1" action="${BASE_URL}/api/ivr/handle-input?from=${encodeURIComponent(from)}&amp;callSid=${encodeURIComponent(callSid)}&amp;calledNumber=${encodeURIComponent(to)}" method="POST" timeout="8">
    <Play>${BASE_URL}/audio/ivr-greeting.mp3</Play>
  </Gather>
  <Redirect method="POST">${BASE_URL}/api/ivr/no-input?from=${encodeURIComponent(from)}&amp;calledNumber=${encodeURIComponent(to)}</Redirect>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
