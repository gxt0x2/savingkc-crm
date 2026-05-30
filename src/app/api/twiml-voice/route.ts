import { NextResponse } from 'next/server'
import { isGoogleAdsPhoneNumber } from '@/lib/call-quality-events'
import { DIALER_CALLER_ID_NUMBERS as TWILIO_NUMBERS } from '@/lib/twilio-numbers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'
const ERNEST_PHONE = process.env.ERNEST_PHONE || '+18162262552'
const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'

const XML_HEADERS: HeadersInit = {
  'Content-Type': 'text/xml',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

// Outbound caller ID per agent identity
const AGENT_CALLER_IDS: Record<string, string> = {
  ernest: '+18166088588',
  casey:  '+18167277667',
}
const ALLOWED_OUTBOUND_CALLER_IDS = new Set<string>([
  TWILIO_PHONE,
  ...Object.values(AGENT_CALLER_IDS),
  ...TWILIO_NUMBERS.map((n) => n.value),
])

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

function normalizePhone(raw: string | null): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (raw.trim().startsWith('+')) return `+${digits}`
  return `+${digits}`
}

function getFormString(body: FormData, keys: string[]): string | null {
  for (const key of keys) {
    const value = body.get(key)
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function xmlResponse(body: string, status = 200) {
  return new NextResponse(body, { status, headers: XML_HEADERS })
}

export async function POST(req: Request) {
  try {
    const body = await req.formData()
    const callSid = body.get('CallSid') as string
    const from = body.get('From') as string
    const to = body.get('To') as string

    // ── OUTBOUND: browser/SDK-initiated call ──
    if (from && from.startsWith('client:')) {
      const sanitizedTo = normalizePhone(to)
      if (!sanitizedTo) {
        const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>No destination number provided.</Say></Response>`
        return xmlResponse(errorTwiml, 400)
      }

      // Use agent's company number as caller ID (from=client:ernest or client:casey)
      const identity = from.replace('client:', '').toLowerCase()
      const requestedCallerId = normalizePhone(getFormString(body, ['CallerId', 'callerId', 'caller_id']))
      const fallbackCallerId = AGENT_CALLER_IDS[identity] || TWILIO_PHONE
      const callerId = requestedCallerId && ALLOWED_OUTBOUND_CALLER_IDS.has(requestedCallerId)
        ? requestedCallerId
        : fallbackCallerId

      const statusCallback = `${BASE_URL}/api/twilio-call-status?identity=${encodeURIComponent(identity)}`
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" timeout="15" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${BASE_URL}/api/twilio-recording-callback" recordingStatusCallbackMethod="POST">
    <Number statusCallback="${statusCallback}" statusCallbackEvent="initiated ringing answered completed" statusCallbackMethod="POST">${sanitizedTo}</Number>
  </Dial>
</Response>`
      return xmlResponse(twiml)
    }

    // ── GOOGLE ADS: dedicated paid-search line, no generic IVR ──
    if (isGoogleAdsPhoneNumber(to)) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${BASE_URL}/api/ivr/google-ads?from=${encodeURIComponent(from)}&amp;callSid=${encodeURIComponent(callSid)}&amp;calledNumber=${encodeURIComponent(to)}</Redirect>
</Response>`
      return xmlResponse(twiml)
    }

    // ── DIRECT RING: Company numbers ring agent cell (no IVR) ──
    if (DIRECT_RING_NUMBERS[to]) {
      const agentPhone = DIRECT_RING_NUMBERS[to]
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${BASE_URL}/api/ivr/dial-result?from=${encodeURIComponent(from)}&amp;leadId=&amp;calledNumber=${encodeURIComponent(to)}&amp;type=direct" method="POST" timeout="15" callerId="${to}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${BASE_URL}/api/twilio-recording-callback" recordingStatusCallbackMethod="POST">
    <Number url="${BASE_URL}/api/ivr/whisper?type=direct&amp;from=${encodeURIComponent(from)}&amp;calledNumber=${encodeURIComponent(to)}">${agentPhone}</Number>
  </Dial>
</Response>`
      return xmlResponse(twiml)
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
      return xmlResponse(twiml)
    }

    // ── STANDARD INBOUND: ElevenLabs Jessica greeting ──
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${BASE_URL}/api/ivr/handle-input?from=${encodeURIComponent(from)}&amp;callSid=${encodeURIComponent(callSid)}&amp;calledNumber=${encodeURIComponent(to)}" method="POST" timeout="5">
    <Play>${BASE_URL}/api/audio/ivr-greeting.mp3</Play>
  </Gather>
  <Redirect method="POST">${BASE_URL}/api/ivr/no-input?from=${encodeURIComponent(from)}&amp;calledNumber=${encodeURIComponent(to)}</Redirect>
</Response>`

    return xmlResponse(twiml)
  } catch (error) {
    console.error('[IVR] Critical error in main handler:', error)
    // Emergency fallback: ring Ernest's cell directly
    const emergencyTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="15">
    <Number>${ERNEST_PHONE}</Number>
  </Dial>
</Response>`
    return xmlResponse(emergencyTwiml)
  }
}
