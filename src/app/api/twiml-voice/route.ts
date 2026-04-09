import { NextResponse } from 'next/server'

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'
const ERNEST_PHONE = process.env.ERNEST_PHONE || '+18162262552'
const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'

// Outbound caller ID per agent identity
const AGENT_CALLER_IDS: Record<string, string> = {
  ernest: '+18166088588',
  casey:  '+18167277667',
}

// Company numbers that ring agent cell directly (no IVR)
const DIRECT_RING_NUMBERS: Record<string, string> = {
  '+18166088588': ERNEST_PHONE,
  '+18167277667': CASEY_PHONE,
}

// Cold call outbound dialing numbers — callbacks get a different IVR
const COLD_CALL_NUMBERS = new Set([
  '+18163100845',
  '+18162538313',
  '+18164761344',
  '+18164761589',
  '+18166404701',
  '+18165788107',
  '+18166408032',
  '+18166536616',
])

export async function POST(req: Request) {
  const body = await req.formData()
  const callSid = body.get('CallSid') as string
  const from = body.get('From') as string
  const to = body.get('To') as string

  // ── OUTBOUND: browser/SDK-initiated call ──
  if (from && from.startsWith('client:')) {
    const sanitizedTo = to ? to.replace(/[^\d+]/g, '') : ''
    if (!sanitizedTo) {
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>No destination number provided.</Say></Response>`
      return new NextResponse(errorTwiml, { headers: { 'Content-Type': 'text/xml' } })
    }

    // Use agent's company number as caller ID (from=client:ernest or client:casey)
    const identity = from.replace('client:', '').toLowerCase()
    const callerId = AGENT_CALLER_IDS[identity] || TWILIO_PHONE

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" timeout="15" record="record-from-answer-dual">
    <Number>${sanitizedTo}</Number>
  </Dial>
</Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // ── DIRECT RING: Company numbers ring agent cell (no IVR) ──
  if (DIRECT_RING_NUMBERS[to]) {
    const agentPhone = DIRECT_RING_NUMBERS[to]
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${BASE_URL}/api/ivr/dial-result?from=${encodeURIComponent(from)}&amp;leadId=&amp;calledNumber=${encodeURIComponent(to)}&amp;type=direct" method="POST" timeout="15" callerId="${to}">
    <Number url="${BASE_URL}/api/ivr/whisper?type=direct&amp;from=${encodeURIComponent(from)}&amp;calledNumber=${encodeURIComponent(to)}">${agentPhone}</Number>
  </Dial>
</Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // ── COLD CALL CALLBACK: different IVR — qualify before ringing agents ──
  if (COLD_CALL_NUMBERS.has(to)) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${BASE_URL}/api/ivr/handle-input?from=${encodeURIComponent(from)}&amp;callSid=${encodeURIComponent(callSid)}&amp;calledNumber=${encodeURIComponent(to)}&amp;coldcall=1" method="POST" timeout="4">
    <Play>${BASE_URL}/api/audio/ivr-press1.mp3</Play>
  </Gather>
  <Redirect method="POST">${BASE_URL}/api/ivr/cold-no-input?from=${encodeURIComponent(from)}&amp;calledNumber=${encodeURIComponent(to)}</Redirect>
</Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // ── STANDARD INBOUND: ElevenLabs Jessica greeting ──
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${BASE_URL}/api/ivr/handle-input?from=${encodeURIComponent(from)}&amp;callSid=${encodeURIComponent(callSid)}&amp;calledNumber=${encodeURIComponent(to)}" method="POST" timeout="5">
    <Play>${BASE_URL}/api/audio/ivr-greeting.mp3</Play>
  </Gather>
  <Redirect method="POST">${BASE_URL}/api/ivr/no-input?from=${encodeURIComponent(from)}&amp;calledNumber=${encodeURIComponent(to)}</Redirect>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
